import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import argon2 from "argon2";
import { groth16 } from "snarkjs";
import { fileURLToPath } from "node:url";
import { db } from "../src/db.js";
import { createApp } from "../src/app.js";
import { hash } from "../src/commerce.js";
import { issueAgeCredential } from "../../issuer/issue-age.js";
import {
  AGE_ISSUER_ID,
  ageNullifier,
  userIdHash,
  type AgeChallengeResponse,
  type AgeCredentialFile,
} from "../../shared/g3.js";

if (process.env.G2_TEST !== "1" || !/^g2_test(?:_[a-z0-9_]+)?$/.test(
  new URL(process.env.DATABASE_URL!).searchParams.get("schema") || "",
))
  throw new Error("Refuse tests against non-test database");

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyBase64url = (
  publicKey.export({ format: "jwk" }) as import("node:crypto").JsonWebKey
).x!;
const fingerprint = createHash("sha256")
  .update(Buffer.from(publicKeyBase64url, "base64url"))
  .digest("hex");
const app = await createApp(db, {
  issuer: {
    issuerId: AGE_ISSUER_ID,
    keyVersion: 1,
    publicKey: publicKeyBase64url,
    fingerprint,
  },
});
const root = new URL("../../../", import.meta.url);
const wasm = fileURLToPath(
  new URL(".work/build/age/age_eligibility_js/age_eligibility.wasm", root),
);
const zkey = fileURLToPath(
  new URL(".work/setup/owner/age_contributed.zkey", root),
);
const run = randomUUID().slice(0, 8);
let clientSequence = 1;
const category = await db.category.create({
  data: { name: "G3 " + run, slug: "g3-" + run },
});
const passwordHash = await argon2.hash("Integration@2026", {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

async function client() {
  const remoteAddress = `127.0.0.${clientSequence++}`;
  const token = randomBytes(32).toString("hex");
  const user = await db.user.create({
    data: {
      email: randomUUID() + "@g3.test.invalid",
      name: "G3 test",
      passwordHash,
      cart: { create: {} },
      addresses: {
        create: {
          name: "G3 test",
          phone: "0900000000",
          line: "18 Test street",
          city: "Test city",
        },
      },
      sessions: {
        create: {
          id: hash(token),
          expiresAt: new Date(Date.now() + 3_600_000),
        },
      },
    },
    include: { addresses: true },
  });
  const csrf = await app.inject({ url: "/api/csrf" });
  const csrfToken = csrf.json().token;
  const headers = {
    cookie: `bvv_session=${token}; bvv_csrf=${csrfToken}`,
    origin: "http://127.0.0.1:5173",
    "x-csrf-token": csrfToken,
  };
  return {
    user,
    address: user.addresses[0],
    request: (method: any, path: string, payload?: any) =>
      app.inject({
        method,
        url: "/api" + path,
        payload,
        headers,
        remoteAddress,
      }),
  };
}

async function ageProduct(stock = 10) {
  return db.product.create({
    data: {
      slug: randomUUID(),
      name: "Rượu demo G3",
      subtitle: "Test",
      description: "Fictional test product",
      price: 220000n,
      stock,
      weight: "500 ml",
      origin: "Demo",
      art: "wine",
      tone: "#734733",
      categoryId: category.id,
      requiresAgeProof: true,
      minimumAge: 18,
    },
  });
}

async function add(c: Awaited<ReturnType<typeof client>>, productId: string) {
  const response = await c.request("POST", "/cart/items", {
    productId,
    quantity: 1,
  });
  assert.equal(response.statusCode, 200, response.body);
}

async function credential(userId: string, dateOfBirth = "2000-01-01") {
  const issuedAtSeconds = Math.floor(Date.now() / 1000) - 10;
  return issueAgeCredential({
    userId,
    dateOfBirth,
    privateKey,
    publicKeyBase64url,
    fingerprint,
    issuedAtSeconds,
    expiresAtSeconds: issuedAtSeconds + 86_400,
  });
}

async function prove(
  value: AgeCredentialFile,
  challenge: AgeChallengeResponse,
) {
  const nullifier = await ageNullifier(
    value.privateInputs.holderSecret,
    challenge.requestHash,
  );
  const result = await groth16.fullProve(
    {
      ...value.privateInputs,
      commitment: value.metadata.commitment,
      cutoffDay: challenge.cutoffDay,
      requestHash: challenge.requestHash,
      nullifier,
    },
    wasm,
    zkey,
  );
  return {
    challengeId: challenge.id,
    credential: {
      metadata: value.metadata,
      issuerFingerprint: value.issuerFingerprint,
      signature: value.signature,
    },
    proof: result.proof,
    publicSignals: result.publicSignals,
  };
}

async function prepared() {
  const c = await client();
  const product = await ageProduct();
  await add(c, product.id);
  const challengeResponse = await c.request("POST", "/age/challenges", {});
  assert.equal(challengeResponse.statusCode, 200, challengeResponse.body);
  const challenge = challengeResponse.json() as AgeChallengeResponse;
  const value = await credential(c.user.id);
  const bundle = await prove(value, challenge);
  const cart = (await c.request("GET", "/cart")).json();
  return { c, product, challenge, value, bundle, cart };
}

async function verifyAge(
  fixture: Awaited<ReturnType<typeof prepared>>,
  bundle: unknown = fixture.bundle,
) {
  const response = await fixture.c.request(
    "POST",
    "/age/verifications",
    bundle,
  );
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as {
    verificationId: string;
    challengeId: string;
    status: "VERIFIED";
  };
}

try {
  await test("G3 age ZKP integration", async (t) => {
    const valid = await prepared();

    await t.test(
      "valid proof creates COD order and persists public audit data only",
      async () => {
        const checked = await verifyAge(valid);
        assert.equal(checked.challengeId, valid.challenge.id);
        const response = await valid.c.request("POST", "/orders", {
          addressId: valid.c.address.id,
          idempotencyKey: randomUUID(),
          quote: valid.cart.quote,
          ageVerificationId: checked.verificationId,
        });
        assert.equal(response.statusCode, 200, response.body);
        const order = response.json();
        assert(order.ageVerificationId);
        assert.equal(order.ageRequestHash, valid.challenge.requestHash);
        const verification = await db.ageVerification.findUniqueOrThrow({
          where: { id: order.ageVerificationId },
          include: { challenge: true },
        });
        assert(verification.consumedAt);
        assert.equal(verification.challenge.status, "CONSUMED");
        const persisted = JSON.stringify(verification);
        assert(!persisted.includes(valid.value.privateInputs.dobDay));
        assert(!persisted.includes(valid.value.privateInputs.salt));
        assert(!persisted.includes(valid.value.privateInputs.holderSecret));
      },
    );

    await t.test("lost verify response is recoverable for the current cart", async () => {
      const fixture = await prepared();
      const accepted = await fixture.c.request("POST", "/age/verifications", fixture.bundle);
      assert.equal(accepted.statusCode, 200, accepted.body);
      const recovered = await fixture.c.request("GET", "/age/verifications/current");
      assert.equal(recovered.statusCode, 200, recovered.body);
      assert.equal(recovered.json().status, "VERIFIED");
      assert.equal(recovered.json().verificationId, accepted.json().verificationId);
      assert.equal(recovered.json().challengeId, fixture.challenge.id);
      for (const secret of ["proof", "publicSignals", "credential", "nullifier", "holderSecret", "salt", "witness"])
        assert.equal(recovered.body.includes(secret), false);
      const retried = await fixture.c.request("POST", "/age/verifications", fixture.bundle);
      assert.equal(retried.statusCode, 200, retried.body);
      assert.equal(retried.json().verificationId, accepted.json().verificationId);
      assert.equal(await db.ageVerification.count({ where: { challengeId: fixture.challenge.id } }), 1);
    });

    await t.test("recovery rejects changed cart, expired and consumed verification", async () => {
      const changed = await prepared();
      await verifyAge(changed);
      await add(changed.c, changed.product.id);
      assert.equal((await changed.c.request("GET", "/age/verifications/current")).body, "null");

      const expired = await prepared();
      const expiredResult = await verifyAge(expired);
      await db.ageVerification.update({ where: { id: expiredResult.verificationId }, data: { expiresAt: new Date(Date.now() - 1) } });
      assert.equal((await expired.c.request("GET", "/age/verifications/current")).body, "null");

      const consumed = await prepared();
      const consumedResult = await verifyAge(consumed);
      await db.$transaction([
        db.ageVerification.update({ where: { id: consumedResult.verificationId }, data: { consumedAt: new Date() } }),
        db.ageChallenge.update({ where: { id: consumed.challenge.id }, data: { status: "CONSUMED", consumedAt: new Date() } }),
      ]);
      assert.equal((await consumed.c.request("GET", "/age/verifications/current")).body, "null");
    });

    await t.test("underage witness cannot produce a proof", async () => {
      const c = await client();
      const product = await ageProduct();
      await add(c, product.id);
      const challenge = (
        await c.request("POST", "/age/challenges", {})
      ).json() as AgeChallengeResponse;
      const firstIneligibleDay = new Date(
        Date.UTC(1900, 0, 1) + (Number(challenge.cutoffDay) + 1) * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
      const value = await credential(c.user.id, firstIneligibleDay);
      await assert.rejects(() => prove(value, challenge));
    });

    await t.test(
      "tampered proof, public signals, and Issuer signature are rejected",
      async () => {
        const fixture = await prepared();
        const proofTampered = structuredClone(fixture.bundle);
        (proofTampered.proof as any).pi_a[0] = (
          BigInt((proofTampered.proof as any).pi_a[0]) + 1n
        ).toString();
        const proofResponse = await fixture.c.request(
          "POST",
          "/age/verifications",
          proofTampered,
        );
        assert.equal(proofResponse.json().code, "PROOF_INVALID");

        const signalsTampered = structuredClone(fixture.bundle);
        signalsTampered.publicSignals[2] = (
          BigInt(signalsTampered.publicSignals[2]) + 1n
        ).toString();
        const signalsResponse = await fixture.c.request(
          "POST",
          "/age/verifications",
          signalsTampered,
        );
        assert.equal(signalsResponse.json().code, "PUBLIC_SIGNALS_INVALID");

        const signatureTampered = structuredClone(fixture.bundle);
        signatureTampered.credential.signature =
          (signatureTampered.credential.signature[0] === "A" ? "B" : "A") +
          signatureTampered.credential.signature.slice(1);
        const signatureResponse = await fixture.c.request(
          "POST",
          "/age/verifications",
          signatureTampered,
        );
        assert.equal(signatureResponse.json().code, "ISSUER_SIGNATURE_INVALID");
      },
    );

    await t.test(
      "expired challenge is rejected before proof verification",
      async () => {
        const fixture = await prepared();
        await db.ageChallenge.update({
          where: { id: fixture.challenge.id },
          data: {
            issuedAt: new Date(Date.now() - 600_000),
            expiresAt: new Date(Date.now() - 300_000),
          },
        });
        const response = await fixture.c.request(
          "POST",
          "/age/verifications",
          fixture.bundle,
        );
        assert.equal(response.json().code, "CHALLENGE_EXPIRED");
      },
    );

    await t.test("cart change invalidates requestHash binding", async () => {
      const fixture = await prepared();
      await add(fixture.c, fixture.product.id);
      const response = await fixture.c.request(
        "POST",
        "/age/verifications",
        fixture.bundle,
      );
      assert.equal(response.json().code, "CART_CHANGED");
    });

    await t.test("a consumed proof cannot create a second order", async () => {
      await add(valid.c, valid.product.id);
      const cart = (await valid.c.request("GET", "/cart")).json();
      const verification = await db.ageVerification.findUniqueOrThrow({
        where: { challengeId: valid.challenge.id },
      });
      const response = await valid.c.request("POST", "/orders", {
        addressId: valid.c.address.id,
        idempotencyKey: randomUUID(),
        quote: cart.quote,
        ageVerificationId: verification.id,
      });
      assert.equal(response.json().code, "AGE_PROOF_REPLAY");
    });

    await t.test(
      "concurrent identical retries create one order and consume stock once",
      async () => {
        const fixture = await prepared();
        const checked = await verifyAge(fixture);
        const idempotencyKey = randomUUID();
        const input = {
          addressId: fixture.c.address.id,
          idempotencyKey,
          quote: fixture.cart.quote,
          ageVerificationId: checked.verificationId,
        };
        const responses = await Promise.all(
          Array.from({ length: 6 }, () =>
            fixture.c.request("POST", "/orders", input),
          ),
        );
        assert(
          responses.every((response) => response.statusCode === 200),
          responses.map((r) => r.body).join("\n"),
        );
        assert.equal(
          new Set(responses.map((response) => response.json().id)).size,
          1,
        );
        assert.equal(
          (
            await db.product.findUniqueOrThrow({
              where: { id: fixture.product.id },
            })
          ).stock,
          9,
        );
        assert.equal(
          await db.order.count({
            where: { userId: fixture.c.user.id, idempotencyKey },
          }),
          1,
        );
        const delayedRetry = await fixture.c.request("POST", "/orders", input);
        assert.equal(delayedRetry.statusCode, 200, delayedRetry.body);
        assert.equal(delayedRetry.json().id, responses[0].json().id);
      },
    );

    await t.test(
      "18+ checkout is blocked without an API verification",
      async () => {
        const fixture = await prepared();
        const response = await fixture.c.request("POST", "/orders", {
          addressId: fixture.c.address.id,
          idempotencyKey: randomUUID(),
          quote: fixture.cart.quote,
        });
        assert.equal(response.json().code, "AGE_PROOF_REQUIRED");
      },
    );

    await t.test(
      "a failed checkout leaves verification retryable until transaction succeeds",
      async () => {
        const fixture = await prepared();
        const checked = await verifyAge(fixture);
        await db.product.update({
          where: { id: fixture.product.id },
          data: { stock: 0 },
        });
        const input = {
          addressId: fixture.c.address.id,
          idempotencyKey: randomUUID(),
          quote: fixture.cart.quote,
          ageVerificationId: checked.verificationId,
        };
        const failed = await fixture.c.request("POST", "/orders", input);
        assert.equal(failed.json().code, "OUT_OF_STOCK");
        const stillValid = await db.ageVerification.findUniqueOrThrow({
          where: { id: checked.verificationId },
          include: { challenge: true },
        });
        assert.equal(stillValid.consumedAt, null);
        assert.equal(stillValid.challenge.status, "VERIFIED");
        await db.product.update({
          where: { id: fixture.product.id },
          data: { stock: 10 },
        });
        const retried = await fixture.c.request("POST", "/orders", input);
        assert.equal(retried.statusCode, 200, retried.body);
      },
    );

    await t.test(
      "one verification covers a cart containing multiple 18+ products",
      async () => {
        const c = await client();
        const first = await ageProduct();
        const second = await ageProduct();
        await add(c, first.id);
        await add(c, second.id);
        const challenge = (
          await c.request("POST", "/age/challenges", {})
        ).json() as AgeChallengeResponse;
        const value = await credential(c.user.id);
        const bundle = await prove(value, challenge);
        const cart = (await c.request("GET", "/cart")).json();
        const verified = await c.request("POST", "/age/verifications", bundle);
        assert.equal(verified.statusCode, 200, verified.body);
        const response = await c.request("POST", "/orders", {
          addressId: c.address.id,
          idempotencyKey: randomUUID(),
          quote: cart.quote,
          ageVerificationId: verified.json().verificationId,
        });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().items.length, 2);
        assert.equal(
          await db.ageChallenge.count({ where: { userId: c.user.id } }),
          1,
        );
        assert.equal(
          await db.ageVerification.count({ where: { userId: c.user.id } }),
          1,
        );
      },
    );

    await t.test("duplicate nullifier is rejected by the database invariant", async () => {
      const fixture = await prepared();
      const checked = await verifyAge(fixture);
      const original = await db.ageVerification.findUniqueOrThrow({
        where: { id: checked.verificationId },
        include: { challenge: true },
      });
      const duplicateChallenge = await db.ageChallenge.create({
        data: {
          userId: fixture.c.user.id,
          nonceField: BigInt(
            "0x" + randomBytes(31).toString("hex"),
          ).toString(),
          cartSnapshotHash: original.challenge.cartSnapshotHash,
          cutoffDay: original.challenge.cutoffDay,
          minimumAge: original.challenge.minimumAge,
          requestHash: BigInt(
            "0x" + randomBytes(31).toString("hex"),
          ).toString(),
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 300_000),
        },
      });
      await assert.rejects(
        db.ageVerification.create({
          data: {
            challengeId: duplicateChallenge.id,
            userId: fixture.c.user.id,
            nullifier: original.nullifier,
            credentialId: randomUUID(),
            commitment: original.commitment,
            credentialExpiresAt: original.credentialExpiresAt,
            issuerId: original.issuerId,
            issuerKeyVersion: original.issuerKeyVersion,
            issuerFingerprint: original.issuerFingerprint,
            proofHash: "0".repeat(64),
            verifiedAt: new Date(),
            expiresAt: duplicateChallenge.expiresAt,
          },
        }),
        (error: any) => error?.code === "P2002",
      );
    });

    await t.test(
      "challenge mismatch, replay, and private credential fields are rejected",
      async () => {
        const mismatch = await prepared();
        const other = (
          await mismatch.c.request("POST", "/age/challenges", {})
        ).json() as AgeChallengeResponse;
        const wrongChallenge = structuredClone(mismatch.bundle);
        wrongChallenge.challengeId = other.id;
        const wrong = await mismatch.c.request(
          "POST",
          "/age/verifications",
          wrongChallenge,
        );
        assert.equal(wrong.json().code, "PUBLIC_SIGNALS_INVALID");

        const replay = await prepared();
        const first = await verifyAge(replay);
        const replayed = await replay.c.request(
          "POST",
          "/age/verifications",
          replay.bundle,
        );
        assert.equal(replayed.statusCode, 200, replayed.body);
        assert.equal(replayed.json().verificationId, first.verificationId);

        const leaked = structuredClone((await prepared()).bundle) as any;
        leaked.credential.privateInputs = {
          dobDay: "1",
          salt: "2",
          holderSecret: "3",
        };
        const rejected = await mismatch.c.request(
          "POST",
          "/age/verifications",
          leaked,
        );
        assert.equal(rejected.json().code, "VALIDATION_ERROR");
      },
    );

    await t.test(
      "challenge TTL and public signal order are the pinned G1 values",
      async () => {
        const fixture = await prepared();
        assert.equal(
          new Date(fixture.challenge.expiresAt).getTime() -
            new Date(fixture.challenge.issuedAt).getTime(),
          300_000,
        );
        assert.deepEqual(fixture.challenge.artifact.publicSignals, [
          "commitment",
          "cutoffDay",
          "requestHash",
          "nullifier",
        ]);
        assert.equal(
          fixture.challenge.subjectHash,
          await userIdHash(fixture.c.user.id),
        );
      },
    );
    await t.test("online lifecycle rejects a revoked issued credential", async () => {
      const fixture = await prepared();
      await db.ageCredentialRequest.create({
        data: {
          userId: fixture.c.user.id,
          operatorId: fixture.c.user.id,
          status: "REVOKED",
          reviewedAt: new Date(),
          issuedAt: new Date(Number(fixture.value.metadata.issuedAt) * 1000),
          expiresAt: new Date(Number(fixture.value.metadata.expiresAt) * 1000),
          revokedAt: new Date(),
          revocationReason: "Kiểm thử thu hồi",
          credentialId: fixture.value.metadata.credentialId,
          issuerKeyId: `${AGE_ISSUER_ID}:v1`,
          circuitVersion: 1,
        },
      });
      const rejected = await fixture.c.request(
        "POST",
        "/age/verifications",
        fixture.bundle,
      );
      assert.equal(rejected.statusCode, 403, rejected.body);
      assert.equal(rejected.json().code, "CREDENTIAL_LIFECYCLE_INVALID");
    });
  });
} finally {
  await app.close();
  await db.$disconnect();
  const curve = (globalThis as any).curve_bn128;
  if (curve?.terminate) await curve.terminate();
}
