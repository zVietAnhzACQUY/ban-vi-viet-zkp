import { createHash, randomUUID } from "node:crypto";
import {
  Prisma,
  PrismaClient,
  type OrderStatus,
} from "../generated/client/index.js";
import {
  cartSnapshotHash,
  cutoffDay,
  ageRequestHash,
  userIdHash,
  type CartHashItem,
} from "../../shared/g3.js";
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function fail(code: string, message: string, status = 409): never {
  throw new AppError(status, code, message);
}
export const orderInclude = {
  items: true,
  history: { orderBy: { createdAt: "asc" as const } },
};
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function quoteFor(items: any[]) {
  return hash(
    JSON.stringify(
      items
        .map((i) => [
          i.product.id,
          i.quantity,
          String(i.product.price),
          i.product.requiresAgeProof,
          i.product.minimumAge,
          i.product.published,
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ),
  );
}
export async function userLock(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id}::uuid FOR UPDATE`;
}
export async function cartView(db: PrismaClient, id: string) {
  const c = await db.cart.findUnique({
    where: { userId: id },
    include: {
      items: {
        include: { product: { include: { category: true } } },
        orderBy: { productId: "asc" },
      },
    },
  });
  const items = c?.items || [];
  return {
    items: items.map((i) => ({ product: i.product, quantity: i.quantity })),
    total: items
      .reduce((n, i) => n + i.product.price * BigInt(i.quantity), 0n)
      .toString(),
    quote: quoteFor(items),
  };
}
export async function checkout(
  db: PrismaClient,
  userId: string,
  input: {
    addressId: string;
    idempotencyKey: string;
    quote: string;
    ageVerificationId?: string;
    ageTrust?: { issuerId: string; keyVersion: number; fingerprint: string };
  },
  faultForTest?: () => void,
) {
  return db.$transaction(
    async (tx) => {
      await userLock(tx, userId);
      const requestHash = hash(
        JSON.stringify([
          input.addressId,
          input.quote,
          input.ageVerificationId ?? null,
        ]),
      );
      const previous = await tx.order.findUnique({
        where: {
          userId_idempotencyKey: {
            userId,
            idempotencyKey: input.idempotencyKey,
          },
        },
        include: orderInclude,
      });
      if (previous) {
        if (previous.requestHash !== requestHash)
          fail(
            "IDEMPOTENCY_CONFLICT",
            "Mã yêu cầu đã dùng cho nội dung đặt hàng khác.",
          );
        return previous;
      }
      const address = await tx.address.findFirst({
        where: { id: input.addressId, userId },
      });
      if (!address)
        fail(
          "ADDRESS_NOT_FOUND",
          "Địa chỉ không thuộc tài khoản của bạn.",
          404,
        );
      const cart = await tx.cart.findUnique({
        where: { userId },
        include: { items: { orderBy: { productId: "asc" } } },
      });
      if (!cart?.items.length) fail("CART_EMPTY", "Giỏ hàng đang trống.");
      // Lock products in stable order. All stock/price/state checks occur after the locks.
      const items = [];
      for (const item of cart.items) {
        await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${item.productId}::uuid FOR UPDATE`;
        const product = await tx.product.findUniqueOrThrow({
          where: { id: item.productId },
        });
        items.push({ ...item, product });
      }
      if (items.some((i) => !i.product.published))
        fail(
          "PRODUCT_UNAVAILABLE",
          "Một sản phẩm đã ngừng bán. Hãy cập nhật giỏ hàng.",
        );
      if (quoteFor(items) !== input.quote)
        fail(
          "CART_CHANGED",
          "Giá hoặc giỏ hàng đã thay đổi. Hãy tải lại giỏ trước khi đặt.",
        );
      const minimumAge = Math.max(
        0,
        ...items
          .filter((item) => item.product.requiresAgeProof)
          .map((item) => item.product.minimumAge),
      );
      let ageVerification: any = null;
      if (minimumAge) {
        if (!input.ageVerificationId)
          fail(
            "AGE_PROOF_REQUIRED",
            "Giỏ hàng có sản phẩm 18+. Vui lòng chứng minh đủ tuổi.",
          );
        await tx.$queryRaw`SELECT id FROM "AgeVerification" WHERE id=${input.ageVerificationId}::uuid FOR UPDATE`;
        ageVerification = await tx.ageVerification.findUnique({
          where: { id: input.ageVerificationId },
          include: { challenge: true },
        });
        const time = new Date();
        if (!ageVerification || ageVerification.userId !== userId)
          fail(
            "AGE_VERIFICATION_NOT_FOUND",
            "Kết quả kiểm proof không thuộc tài khoản.",
            404,
          );
        await tx.$queryRaw`SELECT id FROM "AgeChallenge" WHERE id=${ageVerification.challengeId}::uuid FOR UPDATE`;
        if (
          ageVerification.consumedAt ||
          ageVerification.challenge.status !== "VERIFIED" ||
          ageVerification.challenge.consumedAt
        )
          fail("AGE_PROOF_REPLAY", "Proof tuổi đã được dùng để đặt đơn.");
        if (
          ageVerification.expiresAt <= time ||
          ageVerification.credentialExpiresAt <= time ||
          ageVerification.challenge.expiresAt <= time
        )
          fail("AGE_PROOF_EXPIRED", "Kết quả kiểm proof đã hết hạn.");
        if (
          !input.ageTrust ||
          ageVerification.issuerId !== input.ageTrust.issuerId ||
          ageVerification.issuerKeyVersion !== input.ageTrust.keyVersion ||
          ageVerification.issuerFingerprint !== input.ageTrust.fingerprint
        )
          fail(
            "ISSUER_NOT_TRUSTED",
            "Issuer của kết quả proof không còn được tin cậy.",
          );
        const snapshotItems: CartHashItem[] = items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          unitPriceVND: item.product.price.toString(),
          requiresAgeProof: item.product.requiresAgeProof,
          minimumAge: item.product.minimumAge,
        }));
        const snapshotHash = await cartSnapshotHash(snapshotItems);
        const expectedRequestHash = await ageRequestHash(
          ageVerification.challenge.nonceField,
          await userIdHash(userId),
          snapshotHash,
          ageVerification.challenge.cutoffDay,
        );
        if (
          ageVerification.challenge.cartSnapshotHash !== snapshotHash ||
          ageVerification.challenge.minimumAge !== minimumAge ||
          ageVerification.challenge.cutoffDay !== cutoffDay(time, minimumAge) ||
          ageVerification.challenge.requestHash !== expectedRequestHash
        )
          fail(
            "CART_CHANGED",
            "Giỏ hàng hoặc ngày UTC đã đổi sau khi kiểm proof.",
          );
      } else if (input.ageVerificationId) {
        fail(
          "AGE_PROOF_UNEXPECTED",
          "Giỏ hàng này không cần kết quả chứng minh tuổi.",
          400,
        );
      }
      const assignedLots = new Map<string, { id: string; lotCode: string }>();
      for (const item of items) {
        await tx.$queryRaw`SELECT id FROM "Lot" WHERE "productId"=${item.productId}::uuid ORDER BY "lotCode" FOR UPDATE`;
        const lots = await tx.lot.findMany({
          where: { productId: item.productId },
          orderBy: { lotCode: "asc" },
        });
        if (!lots.length) continue;
        const selected = lots.find(
          (lot) => lot.status === "ACTIVE" && lot.stock >= item.quantity,
        );
        if (!selected)
          fail(
            "LOT_OUT_OF_STOCK",
            "Không có một lô đang hoạt động đủ số lượng cho " +
              item.product.name +
              ".",
          );
        assignedLots.set(item.productId, {
          id: selected.id,
          lotCode: selected.lotCode,
        });
      }
      let total = 0n;
      for (const i of items) {
        const updated = await tx.product.updateMany({
          where: { id: i.productId, stock: { gte: i.quantity } },
          data: { stock: { decrement: i.quantity } },
        });
        if (updated.count !== 1)
          fail(
            "OUT_OF_STOCK",
            "Sản phẩm " + i.product.name + " không còn đủ số lượng.",
          );
        const assignedLot = assignedLots.get(i.productId);
        if (assignedLot) {
          const lotUpdated = await tx.lot.updateMany({
            where: {
              id: assignedLot.id,
              status: "ACTIVE",
              stock: { gte: i.quantity },
            },
            data: { stock: { decrement: i.quantity } },
          });
          if (lotUpdated.count !== 1)
            fail(
              "LOT_OUT_OF_STOCK",
              "Tồn của lô " + assignedLot.lotCode + " vừa thay đổi.",
            );
        }
        total += i.product.price * BigInt(i.quantity);
      }
      if (faultForTest) faultForTest(); // Injected by integration test only; never controlled by HTTP.
      const { name, phone, line, city } = address!;
      const order = await tx.order.create({
        data: {
          code: "BVV-" + randomUUID().slice(0, 8).toUpperCase(),
          userId,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          address: { name, phone, line, city },
          total,
          ageVerificationId: ageVerification?.id,
          ageRequestHash: ageVerification?.challenge.requestHash,
          items: {
            create: items.map((i) => {
              const assignedLot = assignedLots.get(i.productId);
              return {
                productId: i.productId,
                name: i.product.name,
                quantity: i.quantity,
                unitPrice: i.product.price,
                lotId: assignedLot?.id,
                lotCode: assignedLot?.lotCode,
              };
            }),
          },
          history: { create: { status: "PENDING" } },
        },
        include: orderInclude,
      });
      await tx.inventoryMovement.createMany({
        data: items.map((i) => ({
          productId: i.productId,
          orderId: order.id,
          delta: -i.quantity,
          reason: "ORDER",
        })),
      });
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      if (ageVerification) {
        const consumedAt = new Date();
        await tx.ageVerification.update({
          where: { id: ageVerification.id },
          data: { consumedAt },
        });
        await tx.ageChallenge.update({
          where: { id: ageVerification.challengeId },
          data: { status: "CONSUMED", consumedAt },
        });
      }
      return order;
    },
    {
      maxWait: 10000,
      timeout: 15000,
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
    },
  );
}
export async function transition(
  db: PrismaClient,
  id: string,
  next: OrderStatus,
  actor: { id: string; role: string },
) {
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Order" WHERE id=${id}::uuid FOR UPDATE`;
      const o = await tx.order.findUnique({
        where: { id },
        include: orderInclude,
      });
      if (!o || (actor.role !== "ADMIN" && o.userId !== actor.id))
        fail("ORDER_NOT_FOUND", "Không tìm thấy đơn hàng.", 404);
      if (
        actor.role !== "ADMIN" &&
        (next !== "CANCELLED" || !["PENDING", "CANCELLED"].includes(o!.status))
      )
        fail("NOT_ALLOWED", "Chỉ có thể hủy đơn đang chờ xác nhận.", 403);
      if (o!.status === next) return o;
      const allowed: Record<string, string[]> = {
        PENDING: ["CONFIRMED", "CANCELLED"],
        CONFIRMED: ["COMPLETED", "CANCELLED"],
        COMPLETED: [],
        CANCELLED: [],
      };
      if (!allowed[o!.status].includes(next))
        fail(
          "INVALID_TRANSITION",
          "Không thể chuyển trạng thái theo thứ tự này.",
        );
      if (next === "CANCELLED")
        for (const i of [...o!.items].sort((a, b) =>
          a.productId.localeCompare(b.productId),
        )) {
          await tx.product.update({
            where: { id: i.productId },
            data: { stock: { increment: i.quantity } },
          });
          if (i.lotId) {
            await tx.$queryRaw`SELECT id FROM "Lot" WHERE id=${i.lotId}::uuid FOR UPDATE`;
            await tx.lot.update({
              where: { id: i.lotId },
              data: { stock: { increment: i.quantity } },
            });
          }
          await tx.inventoryMovement.create({
            data: {
              productId: i.productId,
              orderId: id,
              delta: i.quantity,
              reason: "CANCEL",
            },
          });
        }
      await tx.orderHistory.create({ data: { orderId: id, status: next } });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: "ORDER_" + next, objectId: id },
      });
      return tx.order.update({
        where: { id },
        data: {
          status: next,
          codCollectedAt: next === "COMPLETED" ? new Date() : null,
        },
        include: orderInclude,
      });
    },
    { timeout: 15000 },
  );
}
