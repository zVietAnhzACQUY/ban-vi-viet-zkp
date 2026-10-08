import { db } from "./db.js";
import argon2 from "argon2";
import { catalog, categories } from "../../shared/catalog.js";
const passwordHash = await argon2.hash("BanViViet@2026", {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
});
for (const [email, name, role] of [
  ["admin@banviviet.demo", "Quản trị demo", "ADMIN"],
  ["khach@banviviet.demo", "An Nguyễn (demo)", "CUSTOMER"],
] as const) {
  const u = await db.user.upsert({
    where: { email },
    update: {},
    create: { email, name, role, passwordHash, cart: { create: {} } },
  });
  if (
    role === "CUSTOMER" &&
    !(await db.address.count({ where: { userId: u.id } }))
  )
    await db.address.create({
      data: {
        userId: u.id,
        name: "An Nguyễn (demo)",
        phone: "0900000000",
        line: "12 Đường Minh Họa, Phường Mẫu",
        city: "TP. Hồ Chí Minh",
      },
    });
}
for (const c of categories)
  await db.category.upsert({ where: { slug: c.slug }, update: {}, create: c });
for (const p of catalog) {
  const category = await db.category.findUniqueOrThrow({
    where: { slug: p.category },
  });
  const { category: _, ...rest } = p;
  await db.product.upsert({
    where: { slug: p.slug },
    update: {},
    create: {
      ...rest,
      categoryId: category.id,
      price: BigInt(p.price),
      minimumAge: p.requiresAgeProof ? 18 : 0,
    },
  });
}
for (const [slug, lotCode, certificateStatus, expiresAt, stock] of [
  ["ca-phe-dak-lak", "DL-2026-01", "DEMO_VALID", "2027-09-01", 24],
  ["tra-sen-tay-ho", "TH-2025-02", "DEMO_EXPIRED", "2025-09-01", 18],
  ["hat-dieu-binh-phuoc", "BP-2026-03", "DEMO_REVOKED", "2027-09-01", 20],
] as const) {
  const p = await db.product.findUniqueOrThrow({ where: { slug } });
  await db.lot.upsert({
    where: { productId_lotCode: { productId: p.id, lotCode } },
    update: {},
    create: {
      productId: p.id,
      lotCode,
      certificateStatus,
      expiresAt: new Date(expiresAt),
      stock,
    },
  });
}
console.log(
  "Seed demo ready: 8 products, 3 categories, 3 lots. Existing data was not reset.",
);
await db.$disconnect();
