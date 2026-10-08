import dotenv from "dotenv";
import { createHash, generateKeyPairSync } from "node:crypto";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import argon2 from "argon2";
import { issueAgeCredential } from "../../issuer/issue-age.js";
import { AGE_ISSUER_ID } from "../../shared/g3.js";

dotenv.config({ quiet: true });
if (!process.env.TEST_DATABASE_URL)
  throw new Error("Missing TEST_DATABASE_URL.");
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
const [{ db }, { createApp }] = await Promise.all([
  import("../src/db.js"),
  import("../src/app.js"),
]);

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyBase64url = (
  publicKey.export({ format: "jwk" }) as import("node:crypto").JsonWebKey
).x!;
const fingerprint = createHash("sha256")
  .update(Buffer.from(publicKeyBase64url, "base64url"))
  .digest("hex");
const category = await db.category.upsert({
  where: { slug: "g3-browser" },
  create: { slug: "g3-browser", name: "Kiểm thử G3" },
  update: {},
});
const product = await db.product.upsert({
  where: { slug: "ruou-mo-browser-g3" },
  create: {
    slug: "ruou-mo-browser-g3",
    name: "Rượu mơ kiểm thử G3",
    subtitle: "Sản phẩm hư cấu cho kiểm thử trình duyệt",
    description: "Chỉ dùng trong schema kiểm thử tách biệt.",
    price: 185000n,
    stock: 20,
    weight: "500 ml",
    origin: "Demo",
    art: "wine",
    tone: "#714634",
    categoryId: category.id,
    requiresAgeProof: true,
    minimumAge: 18,
  },
  update: { stock: 20, published: true },
});
const password = "BrowserG3@2026";
const user = await db.user.upsert({
  where: { email: "browser-g3@test.invalid" },
  create: {
    email: "browser-g3@test.invalid",
    name: "Khách kiểm thử G3",
    passwordHash: await argon2.hash(password),
    cart: { create: {} },
    addresses: {
      create: {
        name: "Khách kiểm thử",
        phone: "0900000000",
        line: "18 Đường kiểm thử",
        city: "Hà Nội",
      },
    },
  },
  update: { passwordHash: await argon2.hash(password) },
  include: { cart: true, addresses: true },
});
const cart = user.cart ?? (await db.cart.create({ data: { userId: user.id } }));
await db.cartItem.deleteMany({ where: { cartId: cart.id } });
await db.cartItem.create({
  data: { cartId: cart.id, productId: product.id, quantity: 1 },
});
if (!user.addresses.length)
  await db.address.create({
    data: {
      userId: user.id,
      name: "Khách kiểm thử",
      phone: "0900000000",
      line: "18 Đường kiểm thử",
      city: "Hà Nội",
    },
  });
const now = Math.floor(Date.now() / 1000);
const credential = await issueAgeCredential({
  userId: user.id,
  dateOfBirth: "2000-01-01",
  privateKey,
  publicKeyBase64url,
  fingerprint,
  issuedAtSeconds: now - 10,
  expiresAtSeconds: now + 3600,
});
const credentialPath = resolve(tmpdir(), "bvv-g3-browser-credential.json");
writeFileSync(credentialPath, JSON.stringify(credential), { mode: 0o600 });
const app = await createApp(db, {
  issuer: {
    issuerId: AGE_ISSUER_ID,
    keyVersion: 1,
    publicKey: publicKeyBase64url,
    fingerprint,
  },
});
await app.listen({ host: "127.0.0.1", port: 3001 });
console.log(
  JSON.stringify({
    email: user.email,
    password,
    credentialPath,
    product: product.name,
  }),
);

async function close() {
  try {
    unlinkSync(credentialPath);
  } catch {}
  await app.close();
  await db.$disconnect();
  const curve = (globalThis as any).curve_bn128;
  if (curve?.terminate) await curve.terminate();
  process.exit(0);
}
process.on("SIGINT", close);
process.on("SIGTERM", close);
