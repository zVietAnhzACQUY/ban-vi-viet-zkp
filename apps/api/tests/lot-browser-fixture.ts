import dotenv from "dotenv";
import { createHash, generateKeyPairSync } from "node:crypto";
import { fileURLToPath } from "node:url";
import argon2 from "argon2";
import { issueLotCredential } from "../../issuer/issue-lot.js";
import { createLotProof } from "../../prover/prove-lot.js";
import { LOT_ISSUER_ID } from "../../shared/g4.js";

dotenv.config({ quiet: true });
if (!process.env.TEST_DATABASE_URL || !/^g2_test(?:_[a-z0-9_]+)?$/.test(
  new URL(process.env.TEST_DATABASE_URL).searchParams.get("schema") || "",
))
  throw new Error("Missing TEST_DATABASE_URL.");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.G2_TEST = "1";
const [{ db }, { createApp }, { createLotService }] = await Promise.all([
  import("../src/db.js"),
  import("../src/app.js"),
  import("../src/lot.js"),
]);

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyBase64url = (
  publicKey.export({ format: "jwk" }) as import("node:crypto").JsonWebKey
).x!;
const fingerprint = createHash("sha256")
  .update(Buffer.from(publicKeyBase64url, "base64url"))
  .digest("hex");
const issuer = {
  issuerId: LOT_ISSUER_ID,
  keyVersion: 1 as const,
  publicKey: publicKeyBase64url,
  fingerprint,
};
const category = await db.category.upsert({
  where: { slug: "g4-browser" },
  create: { slug: "g4-browser", name: "Kiểm thử G4" },
  update: {},
});
const product = await db.product.upsert({
  where: { slug: "ca-phe-lo-g4-browser" },
  create: {
    slug: "ca-phe-lo-g4-browser",
    name: "Cà phê lô kiểm thử G4",
    subtitle: "Proof vùng chạy thật trong trình duyệt",
    description: "Sản phẩm hư cấu chỉ dùng trong schema kiểm thử tách biệt.",
    price: 175000n,
    stock: 5,
    weight: "250 g",
    origin: "Vùng demo A",
    art: "coffee",
    tone: "#8b5f3c",
    categoryId: category.id,
    requiresAgeProof: false,
    minimumAge: 0,
  },
  update: { stock: 5, published: true },
});
const lot = await db.lot.upsert({
  where: {
    productId_lotCode: { productId: product.id, lotCode: "G4-BROWSER-01" },
  },
  create: {
    productId: product.id,
    lotCode: "G4-BROWSER-01",
    status: "ACTIVE",
    stock: 5,
  },
  update: { status: "ACTIVE", stock: 5 },
});
await db.lotProof.deleteMany({ where: { lotId: lot.id } });
await db.lotCredential.deleteMany({ where: { lotId: lot.id } });
const admin = await db.user.upsert({
  where: { email: "browser-g4-admin@test.invalid" },
  create: {
    email: "browser-g4-admin@test.invalid",
    name: "Quản trị fixture G4",
    role: "ADMIN",
    passwordHash: await argon2.hash("BrowserG4@2026"),
  },
  update: {},
});
const now = Math.floor(Date.now() / 1000);
const credential = await issueLotCredential({
  productId: product.id,
  lotCode: lot.lotCode,
  supplierCode: "SUP-BROWSER-G4",
  originCode: "1",
  privateKey,
  fingerprint,
  issuedAtSeconds: now - 10,
  expiresAtSeconds: now + 3600,
});
const root = new URL("../../../", import.meta.url);
const bundle = await createLotProof(credential, {
  wasmPath: fileURLToPath(
    new URL(".work/build/lot/lot_origin_js/lot_origin.wasm", root),
  ),
  zkeyPath: fileURLToPath(
    new URL(".work/setup/owner/lot_contributed.zkey", root),
  ),
  publicKeyBase64url,
  fingerprint,
  nowSeconds: now,
});
await createLotService(db, { issuer }).importProof(lot.id, bundle, admin.id);
const app = await createApp(db, {}, { issuer });
await app.listen({ host: "127.0.0.1", port: 3001 });
console.log(
  JSON.stringify({
    url: "http://127.0.0.1:5173/san-pham/" + product.slug,
    product: product.name,
    lotCode: lot.lotCode,
  }),
);

async function close() {
  await app.close();
  await db.$disconnect();
  const curve = (globalThis as any).curve_bn128;
  if (curve?.terminate) await curve.terminate();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
