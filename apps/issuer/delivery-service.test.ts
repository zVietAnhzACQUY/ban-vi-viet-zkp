import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { db } from "../api/src/db.js";
import { hash } from "../api/src/commerce.js";
import { sealAgeCredential } from "./delivery-crypto.js";
import { CLAIM_TTL_MS, createDeliveryApp } from "./delivery-service.js";
import type { AgeCredentialFile } from "../shared/age-wallet.js";
import { AGE_CREDENTIAL_DOMAIN, AGE_ISSUER_ID } from "../shared/g3.js";

if (process.env.G2_TEST !== "1") throw new Error("Delivery tests require G2_TEST=1.");
const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema") || "";
if (!/^g2_test(?:_[a-z0-9_]+)?$/.test(schema)) throw new Error("Refuse non-test DB.");

let clock = new Date();
const key = randomBytes(32);
const portalOrigin = "http://127.0.0.1:5175";
const walletOrigin = "http://127.0.0.1:5174";
const app = await createDeliveryApp(db, { encryptionKey: key, portalOrigin, walletOrigin, now: () => clock });

async function identity() {
  const user = await db.user.create({ data: { email: randomUUID()+"@delivery.test", name: "Delivery", passwordHash: "test" } });
  const raw = randomBytes(32).toString("hex");
  await db.session.create({ data: { id: hash(raw), userId: user.id, expiresAt: new Date(clock.getTime()+3600000) } });
  return { user, raw };
}

async function fixture() {
  const owner = await identity();
  const operator = await db.user.create({ data: { email: randomUUID()+"@operator.test", name: "Operator", passwordHash: "test", role: "ADMIN" } });
  const credentialId = randomUUID();
  const request = await db.ageCredentialRequest.create({ data: {
    userId: owner.user.id, operatorId: operator.id, status: "ISSUED", credentialId,
    reviewedAt: clock, issuedAt: clock, expiresAt: new Date(clock.getTime()+86400000),
    issuerKeyId: `${AGE_ISSUER_ID}:v1`, circuitVersion: 1,
  }});
  const credential: AgeCredentialFile = {
    type: "AGE",
    privateInputs: { dobDay: "1", salt: "2", holderSecret: "3" },
    metadata: { domain: AGE_CREDENTIAL_DOMAIN, schemaVersion: 1, circuitVersion: 1,
      credentialId, issuerId: AGE_ISSUER_ID, commitment: "4", userIdHash: "5",
      issuedAt: String(Math.floor(clock.getTime()/1000)), expiresAt: String(Math.floor(clock.getTime()/1000)+86400), issuerKeyVersion: 1 },
    issuerFingerprint: "a".repeat(64), signature: "A".repeat(86),
  };
  const sealed = sealAgeCredential(credential, key);
  await db.ageCredentialDelivery.create({ data: { requestId: request.id, userId: owner.user.id, credentialId, ...sealed } });
  return { owner, request, credentialId };
}

async function csrf(origin: string, raw: string) {
  const response = await app.inject({ method: "GET", url: "/issuer/csrf", headers: { origin, cookie: `bvv_session=${raw}` } });
  return response.json().token as string;
}
async function post(origin: string, raw: string, path: string, payload: unknown) {
  const token = await csrf(origin, raw);
  return await app.inject({ method: "POST", url: path, payload: payload as object, headers: {
    origin, cookie: `bvv_session=${raw}; bvv_csrf=${token}`, "x-csrf-token": token,
  }});
}

try {
  await test("AGE credential delivery claims", async (t) => {
    await t.test("token is hashed, TTL is five minutes, retry and concurrent ack are idempotent", async () => {
      const f = await fixture();
      const created = await post(portalOrigin, f.owner.raw, "/issuer/age/claims", { requestId: f.request.id });
      assert.equal(created.statusCode, 200, created.body);
      const token = new URL(created.json().claimUrl).searchParams.get("claim")!;
      assert.equal(Buffer.from(token, "base64url").length, 32);
      const stored = await db.ageCredentialClaim.findFirstOrThrow({ where: { requestId: f.request.id } });
      assert.notEqual(stored.tokenHash, token);
      assert.equal(stored.expiresAt.getTime()-stored.createdAt.getTime(), CLAIM_TTL_MS);
      const [a,b] = await Promise.all([
        post(walletOrigin, f.owner.raw, "/issuer/age/claims/redeem", { token }),
        post(walletOrigin, f.owner.raw, "/issuer/age/claims/redeem", { token }),
      ]);
      assert.equal(a.statusCode, 200); assert.equal(b.statusCode, 200);
      const [ackA,ackB] = await Promise.all([
        post(walletOrigin, f.owner.raw, "/issuer/age/claims/ack", { token }),
        post(walletOrigin, f.owner.raw, "/issuer/age/claims/ack", { token }),
      ]);
      assert.equal(ackA.statusCode, 200); assert.equal(ackB.statusCode, 200);
      assert.equal((await db.ageCredentialClaim.findUniqueOrThrow({where:{id:stored.id}})).status, "CLAIMED");
      assert.equal((await post(walletOrigin, f.owner.raw, "/issuer/age/claims/redeem", { token })).statusCode, 409);
    });

    await t.test("wrong user, origin, expiry and revoked request fail closed", async () => {
      const f = await fixture();
      const created = await post(portalOrigin, f.owner.raw, "/issuer/age/claims", { requestId: f.request.id });
      const token = new URL(created.json().claimUrl).searchParams.get("claim")!;
      const other = await identity();
      assert.equal((await post(walletOrigin, other.raw, "/issuer/age/claims/redeem", { token })).statusCode, 403);
      const wrongOrigin = await app.inject({ method:"POST", url:"/issuer/age/claims/redeem", payload:{token}, headers:{origin:"http://evil.invalid"} });
      assert.equal(wrongOrigin.statusCode, 403);
      const commerceCannotCreateClaim = await app.inject({ method:"POST", url:"/issuer/age/claims", payload:{requestId:f.request.id}, headers:{origin:"http://127.0.0.1:5173"} });
      assert.equal(commerceCannotCreateClaim.statusCode, 403);
      clock = new Date(clock.getTime()+CLAIM_TTL_MS+1);
      assert.equal((await post(walletOrigin, f.owner.raw, "/issuer/age/claims/redeem", { token })).statusCode, 410);
      clock = new Date();
      const fresh = await post(portalOrigin, f.owner.raw, "/issuer/age/claims", { requestId: f.request.id });
      const freshToken = new URL(fresh.json().claimUrl).searchParams.get("claim")!;
      await db.ageCredentialRequest.update({ where:{id:f.request.id}, data:{status:"REVOKED", revokedAt:clock, revocationReason:"test"} });
      assert.equal((await post(walletOrigin, f.owner.raw, "/issuer/age/claims/redeem", { token:freshToken })).statusCode, 409);
    });
  });
} finally {
  await app.close();
  await db.$disconnect();
}
