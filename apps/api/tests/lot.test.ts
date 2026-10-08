import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { fileURLToPath } from "node:url";
import argon2 from "argon2";
import { db } from "../src/db.js";
import { createApp } from "../src/app.js";
import { hash } from "../src/commerce.js";
import { issueLotCredential } from "../../issuer/issue-lot.js";
import { createLotProof } from "../../prover/prove-lot.js";
import { verifyLotBundleOffline } from "../../prover/verify-lot-bundle.js";
import { LOT_ISSUER_ID } from "../../shared/g4.js";
import { canonicalLotIssuerKeyId } from "../src/lot.js";

if (process.env.G2_TEST !== "1" || !/^g2_test(?:_[a-z0-9_]+)?$/.test(
  new URL(process.env.DATABASE_URL!).searchParams.get("schema") || "",
))
  throw new Error("Refuse tests against non-test database");

const rootUrl = new URL("../../../", import.meta.url);
const repository = fileURLToPath(rootUrl);
const wasmPath = fileURLToPath(
  new URL(".work/build/lot/lot_origin_js/lot_origin.wasm", rootUrl),
);
const zkeyPath = fileURLToPath(
  new URL(".work/setup/owner/lot_contributed.zkey", rootUrl),
);
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyBase64url = (
  publicKey.export({ format: "jwk" }) as import("node:crypto").JsonWebKey
).x!;
const fingerprint = createHash("sha256")
  .update(Buffer.from(publicKeyBase64url, "base64url"))
  .digest("hex");
let clock = new Date();
const app = await createApp(
  db,
  {},
  {
    issuer: {
      issuerId: LOT_ISSUER_ID,
      keyVersion: 1,
      publicKey: publicKeyBase64url,
      fingerprint,
    },
    now: () => clock,
  },
);
const run = randomUUID().slice(0, 8);
const category = await db.category.create({
  data: { name: "G4 " + run, slug: "g4-" + run },
});
const passwordHash = await argon2.hash("Integration@2026", {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});

async function client(admin = false) {
  const token = randomBytes(32).toString("hex");
  const user = await db.user.create({
    data: {
      email: randomUUID() + "@g4.test.invalid",
      name: "G4 test",
      passwordHash,
      role: admin ? "ADMIN" : "CUSTOMER",
      cart: { create: {} },
      addresses: {
        create: {
          name: "G4 test",
          phone: "0900000000",
          line: "24 Test street",
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
      app.inject({ method, url: "/api" + path, payload, headers }),
  };
}

async function productWithLot(
  stock = 5,
  lotStock = stock,
  code?: string,
  status: "DRAFT" | "ACTIVE" = "ACTIVE",
) {
  const product = await db.product.create({
    data: {
      slug: randomUUID(),
      name: "Sản phẩm G4",
      subtitle: "Test",
      description: "Fictional lot test product",
      price: 165000n,
      stock,
      weight: "250 g",
      origin: "Demo",
      art: "coffee",
      tone: "#45664c",
      categoryId: category.id,
      requiresAgeProof: false,
      minimumAge: 0,
    },
  });
  const lot = await db.lot.create({
    data: {
      productId: product.id,
      lotCode: code || "LOT-" + randomUUID().slice(0, 8).toUpperCase(),
      status,
      stock: lotStock,
    },
  });
  return { product, lot };
}

async function credentialAndProof(
  productId: string,
  lotCode: string,
  validity: { issuedAt: number; expiresAt: number; proveAt?: number },
) {
  const credential = await issueLotCredential({
    productId,
    lotCode,
    supplierCode: "SUP-G4-" + randomUUID().slice(0, 8).toUpperCase(),
    originCode: "1",
    privateKey,
    fingerprint,
    issuedAtSeconds: validity.issuedAt,
    expiresAtSeconds: validity.expiresAt,
  });
  const bundle = await createLotProof(credential, {
    wasmPath,
    zkeyPath,
    publicKeyBase64url,
    fingerprint,
    nowSeconds: validity.proveAt ?? validity.issuedAt + 1,
  });
  return { credential, bundle };
}

async function add(
  c: Awaited<ReturnType<typeof client>>,
  productId: string,
  quantity = 1,
) {
  const response = await c.request("POST", "/cart/items", {
    productId,
    quantity,
  });
  assert.equal(response.statusCode, 200, response.body);
}

async function orderInput(c: Awaited<ReturnType<typeof client>>) {
  return {
    addressId: c.address.id,
    idempotencyKey: randomUUID(),
    quote: (await c.request("GET", "/cart")).json().quote,
  };
}

try {
  await test("G4 lot ZKP and atomic allocation", async (t) => {
    const admin = await client(true);
    const { product, lot } = await productWithLot();
    const now = Math.floor(clock.getTime() / 1000);
    const valid = await credentialAndProof(product.id, lot.lotCode, {
      issuedAt: now - 10,
      expiresAt: now + 3600,
      proveAt: now,
    });

    await t.test("LOT operational state is independent from verification", async () => {
      const target = await productWithLot();
      const created = await admin.request("POST", "/admin/lots", {
        productId: target.product.id,
        lotCode: "DRAFT-" + randomUUID().slice(0, 8).toUpperCase(),
        status: "DRAFT",
        stock: 1,
      });
      assert.equal(created.statusCode, 200, created.body);
      assert.equal(created.json().status, "DRAFT");
      const activated = await admin.request(
        "PATCH",
        "/admin/lots/" + created.json().id,
        { productId: target.product.id, lotCode: created.json().lotCode, status: "ACTIVE", stock: 1 },
      );
      assert.equal(activated.statusCode, 200, activated.body);
      assert.equal(activated.json().status, "ACTIVE");
      const publicStatus = await app.inject({
        url: "/api/lots/" + created.json().id + "/proof-bundle",
      });
      assert.equal(publicStatus.json().status, "UNVERIFIED");
      assert.equal(
        (await db.lot.findUniqueOrThrow({ where: { id: created.json().id } })).status,
        "ACTIVE",
      );
    });

    await t.test(
      "valid signed proof becomes ACTIVE without private inputs",
      async () => {
        const imported = await admin.request(
          "POST",
          "/admin/lots/" + lot.id + "/proof-bundle",
          valid.bundle,
        );
        assert.equal(imported.statusCode, 200, imported.body);
        const response = await app.inject({
          method: "GET",
          url: "/api/lots/" + lot.id + "/proof-bundle",
        });
        assert.equal(response.statusCode, 200, response.body);
        assert.equal(response.json().status, "ACTIVE");
        assert(response.json().bundle?.proof);
        const storedCredential = await db.lotCredential.findUniqueOrThrow({
          where: { id: valid.credential.metadata.credentialId },
        });
        assert.equal(
          storedCredential.issuerKeyId,
          canonicalLotIssuerKeyId(
            valid.credential.metadata.issuerId,
            valid.credential.metadata.issuerKeyVersion,
          ),
        );
        const publicBundle = JSON.stringify(response.json().bundle);
        assert(!publicBundle.includes('"supplierIdHash"'));
        assert(!publicBundle.includes('"salt"'));
        assert(!publicBundle.includes('"privateLotCodeHash"'));
        assert(
          !publicBundle.includes(valid.credential.privateInputs.supplierIdHash),
        );
        assert(!publicBundle.includes(valid.credential.privateInputs.salt));
        const persisted = JSON.stringify(
          await db.lotCredential.findUniqueOrThrow({
            where: { id: valid.credential.metadata.credentialId },
            include: { proof: true },
          }),
        );
        assert(
          !persisted.includes(valid.credential.privateInputs.supplierIdHash),
        );
        assert(!persisted.includes(valid.credential.privateInputs.salt));
        assert(!persisted.includes("privateLotCodeHash"));
      },
    );

    await t.test("tampered proof is rejected", async () => {
      const target = await productWithLot();
      const candidate = await credentialAndProof(target.product.id, target.lot.lotCode, {
        issuedAt: now - 10, expiresAt: now + 3600, proveAt: now,
      });
      const tampered = structuredClone(candidate.bundle) as any;
      tampered.proof.pi_a[0] = String(BigInt(tampered.proof.pi_a[0]) + 1n);
      const response = await admin.request(
        "POST",
        "/admin/lots/" + target.lot.id + "/proof-bundle",
        tampered,
      );
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().code, "PROOF_INVALID");
      assert.equal(
        (await db.lot.findUniqueOrThrow({ where: { id: target.lot.id } })).status,
          "ACTIVE",
      );
    });

    await t.test("invalid issuer signature is rejected", async () => {
      const target = await productWithLot();
      const candidate = await credentialAndProof(target.product.id, target.lot.lotCode, {
        issuedAt: now - 10, expiresAt: now + 3600, proveAt: now,
      });
      const tampered = structuredClone(candidate.bundle) as any;
      tampered.credential.signature =
        (tampered.credential.signature[0] === "A" ? "B" : "A") +
        tampered.credential.signature.slice(1);
      const response = await admin.request(
        "POST",
        "/admin/lots/" + target.lot.id + "/proof-bundle",
        tampered,
      );
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().code, "ISSUER_SIGNATURE_INVALID");
    });

    await t.test("valid proof for another lot is rejected", async () => {
      const other = await productWithLot();
      const response = await admin.request(
        "POST",
        "/admin/lots/" + other.lot.id + "/proof-bundle",
        valid.bundle,
      );
      assert.equal(response.statusCode, 409, response.body);
      assert.equal(response.json().code, "LOT_BINDING_MISMATCH");
    });

    await t.test(
      "expired credential is rejected even with valid Groth16 proof",
      async () => {
        const expiredLot = await productWithLot();
        const expired = await credentialAndProof(
          expiredLot.product.id,
          expiredLot.lot.lotCode,
          {
            issuedAt: now - 120,
            expiresAt: now - 30,
            proveAt: now - 60,
          },
        );
        const response = await admin.request(
          "POST",
          "/admin/lots/" + expiredLot.lot.id + "/proof-bundle",
          expired.bundle,
        );
        assert.equal(response.statusCode, 409, response.body);
        assert.equal(response.json().code, "CREDENTIAL_EXPIRED");
      },
    );

    await t.test(
      "revocation after proof hides bundle while offline math still verifies",
      async () => {
        const revoked = await admin.request(
          "POST",
          "/admin/lots/" + lot.id + "/revoke",
          { reason: "Kiểm thử thu hồi" },
        );
        assert.equal(revoked.statusCode, 200, revoked.body);
        assert.equal(revoked.json().status, "REVOKED");
        assert.equal(revoked.json().bundle, undefined);
        const online = await app.inject({
          method: "GET",
          url: "/api/lots/" + lot.id + "/proof-bundle",
        });
        assert.equal(online.json().status, "REVOKED");
        assert.equal(online.json().bundle, undefined);
        const stored = await db.lotCredential.findUniqueOrThrow({
          where: { id: valid.credential.metadata.credentialId },
          include: { proof: true },
        });
        assert.equal(stored.status, "REVOKED");
        assert.equal(stored.proof?.status, "STALE");
        assert.equal(
          (await db.lot.findUniqueOrThrow({ where: { id: lot.id } })).status,
          "ACTIVE",
        );
        const offline = await verifyLotBundleOffline(valid.bundle, {
          repository,
          nowSeconds: now,
          issuer: {
            issuerId: LOT_ISSUER_ID,
            publicKey: publicKeyBase64url,
            fingerprint,
          },
        });
        assert.equal(offline.valid, true);
      },
    );

    await t.test("changing an ACTIVE lot binding makes proof STALE", async () => {
      const target = await productWithLot();
      const candidate = await credentialAndProof(target.product.id, target.lot.lotCode, {
        issuedAt: now - 10, expiresAt: now + 3600, proveAt: now,
      });
      assert.equal(
        (await admin.request("POST", "/admin/lots/" + target.lot.id + "/proof-bundle", candidate.bundle)).statusCode,
        200,
      );
      const changed = await admin.request("PATCH", "/admin/lots/" + target.lot.id, {
        productId: target.product.id,
        lotCode: target.lot.lotCode + "-R",
        status: "ACTIVE",
        stock: target.lot.stock,
      });
      assert.equal(changed.statusCode, 200, changed.body);
      assert.equal(changed.json().status, "ACTIVE");
      const online = await app.inject({ url: "/api/lots/" + target.lot.id + "/proof-bundle" });
      assert.notEqual(online.json().status, "ACTIVE");
      assert.equal(online.json().status, "STALE");
      assert.equal(online.json().bundle, undefined);
    });

    await t.test(
      "an imported proof becomes EXPIRED from current server time",
      async () => {
        clock = new Date();
        const start = Math.floor(clock.getTime() / 1000);
        const expiringLot = await productWithLot();
        const expiring = await credentialAndProof(
          expiringLot.product.id,
          expiringLot.lot.lotCode,
          { issuedAt: start - 5, expiresAt: start + 5, proveAt: start },
        );
        const imported = await admin.request(
          "POST",
          "/admin/lots/" + expiringLot.lot.id + "/proof-bundle",
          expiring.bundle,
        );
        assert.equal(imported.statusCode, 200, imported.body);
        clock = new Date((start + 6) * 1000);
        const response = await app.inject({
          method: "GET",
          url: "/api/lots/" + expiringLot.lot.id + "/proof-bundle",
        });
        assert.equal(response.json().status, "EXPIRED");
        assert.equal(response.json().bundle, undefined);
        clock = new Date();
      },
    );

    await t.test(
      "concurrent checkout allocates final lot once and cancellation restores it",
      async () => {
        const scarce = await productWithLot(
          2,
          1,
          "LOT-SCARCE-" + run.toUpperCase(),
          "ACTIVE",
        );
        const buyers = await Promise.all([client(), client()]);
        for (const buyer of buyers) await add(buyer, scarce.product.id);
        const inputs = await Promise.all(buyers.map(orderInput));
        const results = await Promise.all(
          buyers.map((buyer, index) =>
            buyer.request("POST", "/orders", inputs[index]),
          ),
        );
        assert.equal(
          results.filter((result) => result.statusCode === 200).length,
          1,
        );
        assert.equal(
          results.filter((result) => result.statusCode === 409).length,
          1,
        );
        assert.equal(
          results.find((result) => result.statusCode === 409)!.json().code,
          "LOT_OUT_OF_STOCK",
        );
        const order = results
          .find((result) => result.statusCode === 200)!
          .json();
        assert.equal(order.items[0].lotId, scarce.lot.id);
        assert.equal(order.items[0].lotCode, scarce.lot.lotCode);
        assert.equal(
          (
            await db.product.findUniqueOrThrow({
              where: { id: scarce.product.id },
            })
          ).stock,
          1,
        );
        assert.equal(
          (await db.lot.findUniqueOrThrow({ where: { id: scarce.lot.id } }))
            .stock,
          0,
        );
        const winner =
          buyers[results.findIndex((result) => result.statusCode === 200)];
        const cancelled = await winner.request(
          "POST",
          "/me/orders/" + order.id + "/cancel",
          {},
        );
        assert.equal(cancelled.statusCode, 200, cancelled.body);
        assert.equal(
          (
            await db.product.findUniqueOrThrow({
              where: { id: scarce.product.id },
            })
          ).stock,
          2,
        );
        assert.equal(
          (await db.lot.findUniqueOrThrow({ where: { id: scarce.lot.id } }))
            .stock,
          1,
        );
      },
    );
  });
} finally {
  await app.close();
  await db.$disconnect();
  const curve = (globalThis as any).curve_bn128;
  if (curve?.terminate) await curve.terminate();
}
