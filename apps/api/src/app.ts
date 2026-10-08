import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import argon2 from "argon2";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z, ZodError } from "zod";
import { PrismaClient, Prisma } from "../generated/client/index.js";
import {
  AppError,
  fail,
  hash,
  cartView,
  userLock,
  checkout,
  transition,
  orderInclude,
} from "./commerce.js";
import { ageProofBundleSchema } from "../../shared/age-wallet.js";
import { createAgeService, type AgeServiceOptions } from "./age.js";
import { createLotService, type LotServiceOptions } from "./lot.js";
const uuid = z.string().uuid();
const str = (n = 200) => z.string().trim().min(1).max(n);
const addressSchema = z
  .object({
    name: str(80),
    phone: z.string().regex(/^[0-9+ ()-]{8,20}$/),
    line: str(250).min(5),
    city: str(80),
  })
  .strict();
const categorySchema = z
  .object({
    name: str(80),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
  })
  .strict();
const productSchema = z
  .object({
    name: str(100),
    slug: categorySchema.shape.slug,
    subtitle: str(150),
    description: str(2000),
    price: z.string().regex(/^(0|[1-9][0-9]{0,11})$/),
    stock: z.number().int().min(0).max(1000000),
    weight: str(60),
    origin: str(100),
    categoryId: uuid,
    art: z.enum([
      "coffee",
      "tea",
      "cashew",
      "ginger",
      "gift",
      "cake",
      "wine",
      "ricewine",
    ]),
    tone: z.string().regex(/^#[a-fA-F0-9]{6}$/),
    requiresAgeProof: z.boolean(),
    minimumAge: z.number().int(),
    published: z.boolean(),
  })
  .strict()
  .refine(
    (p) => p.minimumAge === (p.requiresAgeProof ? 18 : 0),
    "Ngưỡng tuổi phải là 18 hoặc 0.",
  );
const lotSchema = z
  .object({
    productId: uuid,
    lotCode: z.string().regex(/^[A-Z0-9][A-Z0-9-]{0,63}$/),
    status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
    stock: z.number().int().min(0).max(1000000),
  })
  .strict();
const safeUser = (u: any) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
});
const equal = (a: string, b: string) =>
  /^[0-9a-f]{64}$/.test(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export async function createApp(
  db: PrismaClient,
  ageOptions: AgeServiceOptions = {},
  lotOptions: LotServiceOptions = {},
) {
  const app = Fastify({ logger: false, bodyLimit: 32768 });
  const age = createAgeService(db, ageOptions);
  const lotProofs = createLotService(db, lotOptions);
  const secure = process.env.NODE_ENV === "production";
  if (secure && !process.env.WEB_ORIGIN)
    throw new Error("WEB_ORIGIN is required in production.");
  if (secure && !process.env.WALLET_ORIGIN)
    throw new Error("WALLET_ORIGIN is required in production.");
  if (secure && !process.env.ISSUER_PORTAL_ORIGIN)
    throw new Error("ISSUER_PORTAL_ORIGIN is required in production.");
  const origin =
    process.env.WEB_ORIGIN || process.env.APP_ORIGIN || "http://127.0.0.1:5173";
  const walletOrigin = process.env.WALLET_ORIGIN || "http://127.0.0.1:5174";
  const issuerPortalOrigin =
    process.env.ISSUER_PORTAL_ORIGIN || "http://127.0.0.1:5175";
  const browserOrigins = new Set([origin, issuerPortalOrigin]);
  await app.register(cookie);
  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: "1 minute",
  });
  app.decorateRequest("actor", null);
  app.decorateRequest("issuerActor", null);
  app.addHook("preSerialization", async (_req, _res, payload) =>
    JSON.parse(
      JSON.stringify(payload, (_, v) =>
        typeof v === "bigint" ? v.toString() : v,
      ),
    ),
  );
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff");
    const requestOrigin = req.headers.origin;
    const issuerRequest=req.url.startsWith("/api/issuer/auth/")||req.url.startsWith("/api/admin/age-credential-requests");
    if(issuerRequest && requestOrigin && requestOrigin!==issuerPortalOrigin)
      fail("CSRF_ORIGIN","Nguồn yêu cầu không hợp lệ.",403);
    if (requestOrigin && browserOrigins.has(requestOrigin))
      reply
        .header("Access-Control-Allow-Origin", requestOrigin)
        .header("Access-Control-Allow-Credentials", "true")
        .header("Vary", "Origin");
    if (req.method === "OPTIONS") {
      if (!requestOrigin || !browserOrigins.has(requestOrigin))
        fail("CSRF_ORIGIN", "Nguồn yêu cầu không hợp lệ.", 403);
      return reply
        .header("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
        .header("Access-Control-Allow-Headers", "content-type,x-csrf-token")
        .code(204)
        .send();
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (!requestOrigin || !browserOrigins.has(requestOrigin))
        fail("CSRF_ORIGIN", "Nguồn yêu cầu không hợp lệ.", 403);
      const token = req.headers["x-csrf-token"];
      const issuerContext = req.url.startsWith("/api/issuer/auth/") || req.url.startsWith("/api/admin/age-credential-requests");
      if (issuerContext && requestOrigin !== issuerPortalOrigin) fail("CSRF_ORIGIN", "Nguồn yêu cầu không hợp lệ.", 403);
      const expected = issuerContext ? req.cookies.issuer_csrf : req.cookies.bvv_csrf;
      if (
        typeof token !== "string" ||
        !expected ||
        !/^[0-9a-f]{64}$/.test(token) ||
        !equal(token, expected)
      )
        fail(
          "CSRF_TOKEN",
          "Phiên bảo vệ đã thay đổi. Vui lòng tải lại trang.",
          403,
        );
    }
    const token = req.cookies.bvv_session;
    if (token && /^[0-9a-f]{64}$/.test(token)) {
      const s = await db.session.findUnique({
        where: { id: hash(token) },
        include: { user: true },
      });
      if (s && s.expiresAt > new Date() && s.user.role !== "ISSUER_OPERATOR") (req as any).actor = safeUser(s.user);
    }
    const issuerToken = req.cookies.issuer_session;
    if (issuerToken && /^[0-9a-f]{64}$/.test(issuerToken)) {
      const session = await db.session.findUnique({where:{id:hash("issuer:"+issuerToken)},include:{user:true}});
      if(session && session.expiresAt>new Date()) (req as any).issuerActor=safeUser(session.user);
    }
  });
  app.options("/*", async (_req, reply) => reply.code(204).send());
  app.setErrorHandler((e, req, reply) => {
    if (e instanceof ZodError)
      return reply.code(400).send({
        code: "VALIDATION_ERROR",
        message: "Dữ liệu không hợp lệ. Kiểm tra các trường nhập.",
      });
    if (e instanceof AppError)
      return reply
        .code(e.statusCode)
        .send({ code: e.code, message: e.message });
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002")
        return reply
          .code(409)
          .send({ code: "DUPLICATE", message: "Dữ liệu đã tồn tại." });
      if (e.code === "P2003")
        return reply.code(409).send({
          code: "IN_USE",
          message: "Mục này đang được sử dụng hoặc tham chiếu không tồn tại.",
        });
      if (e.code === "P2025")
        return reply
          .code(404)
          .send({ code: "NOT_FOUND", message: "Không tìm thấy dữ liệu." });
    }
    const status = (e as any).statusCode;
    return reply.code(status && status < 500 ? status : 500).send({
      code: "REQUEST_FAILED",
      message:
        status === 429
          ? "Bạn thao tác quá nhanh. Vui lòng thử lại sau."
          : "Không thể xử lý yêu cầu. Vui lòng thử lại.",
    });
  });
  const actor = (req: any, admin = false) => {
    const u = req.actor;
    if (!u) fail("LOGIN_REQUIRED", "Vui lòng đăng nhập.", 401);
    if (admin && u.role !== "ADMIN")
      fail("FORBIDDEN", "Chỉ quản trị viên được thao tác.", 403);
    return u as { id: string; role: string; name: string; email: string };
  };
  const id = (req: any) => uuid.parse(req.params.id);
  const issuerOperator = (req: any) => {
    const user = req.issuerActor;
    if(!user) fail("LOGIN_REQUIRED", "Vui lòng đăng nhập Credential Issuer.",401);
    if (user.role !== "ISSUER_OPERATOR")
      fail("FORBIDDEN", "Tài khoản không có quyền vận hành Credential Issuer", 403);
    return user;
  };
  app.get("/api/health", async () => {
    await db.$queryRaw`SELECT 1`;
    return {
      status: "ok",
      gate: "G5",
      ageZkp: "integrated",
      lotZkp: "integrated",
    };
  });
  const allowWalletArtifact = (req: any, reply: any) => {
    if (req.headers.origin === walletOrigin)
      reply
        .header("Access-Control-Allow-Origin", walletOrigin)
        .header("Vary", "Origin");
  };
  app.get("/api/zkp/age/wasm", async (req, reply) => {
    allowWalletArtifact(req, reply);
    reply
      .header("Content-Type", "application/wasm")
      .header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.send(age.artifact("wasm"));
  });
  app.get("/api/zkp/age/zkey", async (req, reply) => {
    allowWalletArtifact(req, reply);
    reply
      .header("Content-Type", "application/octet-stream")
      .header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.send(age.artifact("zkey"));
  });
  app.get("/api/csrf", async (req, reply) => {
    const token =
      req.cookies.bvv_csrf && /^[0-9a-f]{64}$/.test(req.cookies.bvv_csrf)
        ? req.cookies.bvv_csrf
        : randomBytes(32).toString("hex");
    reply.setCookie("bvv_csrf", token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure,
      maxAge: 86400,
    });
    return { token };
  });
  async function signIn(user: any, req: any, reply: any, issuer = false) {
    const cookieName=issuer?"issuer_session":"bvv_session";
    const sessionId=(value:string)=>hash((issuer?"issuer:":"")+value);
    const token = randomBytes(32).toString("hex");
    if (req.cookies[cookieName])
      await db.session.deleteMany({
        where: { id: sessionId(req.cookies[cookieName]) },
      });
    await db.session.create({
      data: {
        id: sessionId(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    reply.setCookie(cookieName, token, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure,
      maxAge: 86400,
    });
    return { user: safeUser(user) };
  }
  app.post(
    "/api/auth/register",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const body = z
        .object({
          name: str(80).min(2),
          email: z
            .string()
            .trim()
            .email()
            .max(254)
            .transform((s) => s.toLowerCase()),
          password: z.string().min(10).max(128),
        })
        .strict()
        .parse(req.body);
      const passwordHash = await argon2.hash(body.password, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      const user = await db.user.create({
        data: {
          name: body.name,
          email: body.email,
          passwordHash,
          cart: { create: {} },
        },
      });
      return signIn(user, req, reply);
    },
  );
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 15, timeWindow: "1 minute" } } },
    async (req, reply) => {
      const b = z
        .object({
          email: z
            .string()
            .trim()
            .email()
            .max(254)
            .transform((s) => s.toLowerCase()),
          password: z.string().min(1).max(128),
        })
        .strict()
        .parse(req.body);
      const u = await db.user.findUnique({ where: { email: b.email } });
      if (!u || !(await argon2.verify(u.passwordHash, b.password)))
        fail("INVALID_LOGIN", "Thông tin đăng nhập không hợp lệ hoặc tài khoản không được phép truy cập.", 401);
      if (u.role === "ISSUER_OPERATOR")
        fail("INVALID_LOGIN", "Thông tin đăng nhập không hợp lệ hoặc tài khoản không được phép truy cập.", 401);
      return signIn(u, req, reply);
    },
  );
  app.post("/api/auth/logout", async (req, reply) => {
    if (req.cookies.bvv_session)
      await db.session.deleteMany({
        where: { id: hash(req.cookies.bvv_session) },
      });
    reply.clearCookie("bvv_session", { path: "/" });
    return { ok: true };
  });
  app.get("/api/me", async (req) => ({ user: (req as any).actor }));
  app.get("/api/issuer/customer/me",async req=>({user:(req as any).actor?.role==="CUSTOMER"?(req as any).actor:null}));
  app.get("/api/issuer/auth/csrf",async(req,reply)=>{
    if(req.headers.origin!==issuerPortalOrigin)fail("CSRF_ORIGIN","Nguồn yêu cầu không hợp lệ.",403);
    const value=req.cookies.issuer_csrf && /^[0-9a-f]{64}$/.test(req.cookies.issuer_csrf)?req.cookies.issuer_csrf:randomBytes(32).toString("hex");
    reply.setCookie("issuer_csrf",value,{path:"/",httpOnly:true,sameSite:"strict",secure,maxAge:86400});return {token:value};
  });
  const dummyPasswordHash=await argon2.hash(randomBytes(32).toString("hex"),{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
  app.post("/api/issuer/auth/login",{config:{rateLimit:{max:15,timeWindow:"1 minute"}}},async(req,reply)=>{
    const input=z.object({email:z.string().trim().email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(1).max(128)}).strict().safeParse(req.body);
    const user=input.success?await db.user.findUnique({where:{email:input.data.email}}):null;
    const valid=await argon2.verify(user?.passwordHash||dummyPasswordHash,input.success?input.data.password:"").catch(()=>false);
    if(!valid||user?.role!=="ISSUER_OPERATOR")fail("INVALID_LOGIN","Thông tin đăng nhập không hợp lệ hoặc tài khoản không được phép truy cập.",401);
    return signIn(user,req,reply,true);
  });
  app.get("/api/issuer/auth/me",async req=>({user:(req as any).issuerActor?.role==="ISSUER_OPERATOR"?(req as any).issuerActor:null}));
  app.post("/api/issuer/auth/logout",async(req,reply)=>{
    if(req.cookies.issuer_session)await db.session.deleteMany({where:{id:hash("issuer:"+req.cookies.issuer_session)}});
    reply.clearCookie("issuer_session",{path:"/"});return {ok:true};
  });
  app.patch(
    "/api/me/password",
    { config: { rateLimit: { max: 8, timeWindow: "5 minutes" } } },
    async (req) => {
      const u = actor(req);
      const body = z
        .object({
          currentPassword: z.string().min(1).max(128),
          newPassword: z.string().min(10).max(128),
        })
        .strict()
        .refine((value) => value.currentPassword !== value.newPassword, {
          message: "Mật khẩu mới phải khác mật khẩu hiện tại.",
        })
        .parse(req.body);
      const stored = await db.user.findUniqueOrThrow({ where: { id: u.id } });
      if (!(await argon2.verify(stored.passwordHash, body.currentPassword)))
        fail("PASSWORD_INVALID", "Mật khẩu hiện tại không đúng.", 400);
      const passwordHash = await argon2.hash(body.newPassword, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
      });
      const currentSession = req.cookies.bvv_session
        ? hash(req.cookies.bvv_session)
        : "";
      await db.$transaction([
        db.user.update({ where: { id: u.id }, data: { passwordHash } }),
        db.session.deleteMany({
          where: { userId: u.id, id: { not: currentSession } },
        }),
      ]);
      return { ok: true };
    },
  );
  app.get("/api/products", async () => ({
    products: await db.product.findMany({
      where: { published: true },
      include: { category: true },
      orderBy: { name: "asc" },
    }),
    categories: await db.category.findMany({ orderBy: { name: "asc" } }),
  }));
  app.get("/api/products/:slug", async (req) => {
    const slug = str(80).parse((req.params as any).slug);
    const p = await db.product.findFirst({
      where: { slug, published: true },
      include: {
        category: true,
        lots: {
          where: { status: "ACTIVE" },
          orderBy: { lotCode: "asc" },
          select: { id: true, lotCode: true, status: true, stock: true },
        },
      },
    });
    if (!p) fail("NOT_FOUND", "Sản phẩm không tồn tại hoặc đã ngừng bán.", 404);
    return p;
  });
  app.get("/api/zkp/lot/verification-key", async (_req, reply) =>
    reply
      .type("application/json; charset=utf-8")
      .send(lotProofs.verificationKeyBytes),
  );
  app.get("/api/lots/:id/proof-bundle", async (req) =>
    lotProofs.status(id(req)),
  );
  app.get("/api/cart", async (req) => cartView(db, actor(req).id));
  app.post("/api/cart/items", async (req) => {
    const u = actor(req),
      b = z
        .object({ productId: uuid, quantity: z.number().int().min(1).max(99) })
        .strict()
        .parse(req.body);
    await db.$transaction(async (tx) => {
      await userLock(tx, u.id);
      const p = await tx.product.findUnique({ where: { id: b.productId } });
      if (!p?.published) fail("NOT_FOUND", "Sản phẩm không tồn tại.", 404);
      const c = await tx.cart.upsert({
        where: { userId: u.id },
        create: { userId: u.id },
        update: {},
      });
      const i = await tx.cartItem.findUnique({
        where: { cartId_productId: { cartId: c.id, productId: b.productId } },
      });
      const quantity = (i?.quantity || 0) + b.quantity;
      if (quantity > 99 || quantity > p.stock)
        fail("OUT_OF_STOCK", "Số lượng vượt quá tồn kho hoặc giới hạn 99.");
      await tx.cartItem.upsert({
        where: { cartId_productId: { cartId: c.id, productId: p.id } },
        create: { cartId: c.id, productId: p.id, quantity },
        update: { quantity },
      });
    });
    return cartView(db, u.id);
  });
  app.patch("/api/cart/items/:id", async (req) => {
    const u = actor(req),
      productId = id(req),
      b = z
        .object({ quantity: z.number().int().min(1).max(99) })
        .strict()
        .parse(req.body);
    await db.$transaction(async (tx) => {
      await userLock(tx, u.id);
      const p = await tx.product.findUnique({ where: { id: productId } });
      if (!p?.published || p.stock < b.quantity)
        fail("OUT_OF_STOCK", "Sản phẩm không còn đủ số lượng.");
      const c = await tx.cart.findUnique({ where: { userId: u.id } });
      if (!c) fail("NOT_FOUND", "Không có giỏ hàng.", 404);
      const r = await tx.cartItem.updateMany({
        where: { cartId: c!.id, productId },
        data: b,
      });
      if (!r.count) fail("NOT_FOUND", "Sản phẩm chưa có trong giỏ.", 404);
    });
    return cartView(db, u.id);
  });
  app.delete("/api/cart/items/:id", async (req) => {
    const u = actor(req),
      productId = id(req);
    await db.$transaction(async (tx) => {
      await userLock(tx, u.id);
      await tx.cartItem.deleteMany({
        where: { productId, cart: { userId: u.id } },
      });
    });
    return { ok: true };
  });
  app.get("/api/me/addresses", async (req) =>
    db.address.findMany({
      where: { userId: actor(req).id },
      orderBy: { name: "asc" },
    }),
  );
  app.post("/api/me/addresses", async (req) =>
    db.address.create({
      data: { ...addressSchema.parse(req.body), userId: actor(req).id },
    }),
  );
  app.patch("/api/me/addresses/:id", async (req) => {
    const r = await db.address.updateMany({
      where: { id: id(req), userId: actor(req).id },
      data: addressSchema.parse(req.body),
    });
    if (!r.count) fail("NOT_FOUND", "Địa chỉ không tồn tại.", 404);
    return { ok: true };
  });
  app.delete("/api/me/addresses/:id", async (req) => {
    const r = await db.address.deleteMany({
      where: { id: id(req), userId: actor(req).id },
    });
    if (!r.count) fail("NOT_FOUND", "Địa chỉ không tồn tại.", 404);
    return { ok: true };
  });
  app.post(
    "/api/age/challenges",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (req) => {
      z.object({}).strict().parse(req.body);
      return age.challenge(actor(req).id);
    },
  );
  app.post(
    "/api/age/verifications",
    { config: { rateLimit: { max: 12, timeWindow: "1 minute" } } },
    async (req) => {
      const startedAt = performance.now();
      const verification = await age.verifyForCheckout(
        actor(req).id,
        ageProofBundleSchema.parse(req.body),
      );
      return {
        status: "VERIFIED" as const,
        verificationId: verification.id,
        challengeId: verification.challengeId,
        nullifier: verification.nullifier,
        verifiedAt: verification.verifiedAt,
        expiresAt: verification.expiresAt,
        serverVerificationMs: performance.now() - startedAt,
      };
    },
  );
  app.post("/api/orders", async (req) => {
    const user = actor(req);
    const body = z
      .object({
        addressId: uuid,
        idempotencyKey: uuid,
        quote: z.string().regex(/^[a-f0-9]{64}$/),
        ageVerificationId: uuid.optional(),
      })
      .strict()
      .parse(req.body);
    const previous = await db.order.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: user.id,
          idempotencyKey: body.idempotencyKey,
        },
      },
      include: orderInclude,
    });
    if (previous) {
      if ((previous.ageVerificationId ?? undefined) !== body.ageVerificationId)
        fail(
          "IDEMPOTENCY_CONFLICT",
          "Mã yêu cầu đã dùng cho nội dung đặt hàng khác.",
        );
      const retryHash = hash(
        JSON.stringify([
          body.addressId,
          body.quote,
          body.ageVerificationId ?? null,
        ]),
      );
      if (previous.requestHash !== retryHash)
        fail(
          "IDEMPOTENCY_CONFLICT",
          "Mã yêu cầu đã dùng cho nội dung đặt hàng khác.",
        );
      return previous;
    }
    return checkout(db, user.id, {
      addressId: body.addressId,
      idempotencyKey: body.idempotencyKey,
      quote: body.quote,
      ageVerificationId: body.ageVerificationId,
      ageTrust: body.ageVerificationId ? age.trust : undefined,
    });
  });
  app.get("/api/me/orders", async (req) =>
    db.order.findMany({
      where: { userId: actor(req).id },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  );
  app.get("/api/me/orders/:id", async (req) => {
    const o = await db.order.findFirst({
      where: { id: id(req), userId: actor(req).id },
      include: orderInclude,
    });
    if (!o) fail("NOT_FOUND", "Không tìm thấy đơn hàng.", 404);
    return o;
  });
  app.post("/api/me/orders/:id/cancel", async (req) =>
    transition(db, id(req), "CANCELLED", actor(req)),
  );
  const effectiveAgeRequest = (request: any) => ({
    ...request,
    status:
      request.expiresAt && request.expiresAt <= new Date() && request.status === "ISSUED"
        ? "EXPIRED"
        : request.status,
  });
  const minimalAgeRequest = (request: any) => {
    const effective = effectiveAgeRequest(request);
    return {
      id: effective.id,
      status: effective.status,
      createdAt: effective.createdAt,
      recordSubmitted: Boolean(effective.recordSubmittedAt),
    };
  };
  app.get("/api/me/age-credential-status", async (req) => {
    const user = actor(req);
    const request = await db.ageCredentialRequest.findFirst({
      where: { userId: user.id },
      select: { id: true, status: true, createdAt: true, expiresAt: true, recordSubmittedAt: true },
      orderBy: { createdAt: "desc" },
    });
    if (!request) return null;
    return minimalAgeRequest(request);
  });
  app.get("/api/me/age-credential-requests", async (req) => {
    const user = actor(req);
    return (await db.ageCredentialRequest.findMany({
      where: { userId: user.id },
      select: { id: true, status: true, createdAt: true, expiresAt: true, recordSubmittedAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    })).map(minimalAgeRequest);
  });
  app.get("/api/me/age-credential-requests/:id", async (req) => {
    const user = actor(req);
    const request = await db.ageCredentialRequest.findFirst({
      where: { id: id(req), userId: user.id },
      select: { id: true, status: true, createdAt: true, expiresAt: true, recordSubmittedAt: true },
    });
    if (!request) fail("REQUEST_NOT_FOUND", "Không tìm thấy yêu cầu của tài khoản này.", 404);
    return minimalAgeRequest(request);
  });
  app.post("/api/me/age-credential-requests", async (req) => {
    const user = actor(req);
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${user.id}::uuid FOR UPDATE`;
      const open = await tx.ageCredentialRequest.findFirst({
        where: { userId: user.id, status: { in: ["PENDING", "APPROVED", "ISSUING"] } },
        orderBy: { createdAt: "desc" },
      });
      if (open) return minimalAgeRequest(open);
      const active = await tx.ageCredentialRequest.findFirst({
        where: { userId: user.id, status: "ISSUED", expiresAt: { gt: new Date() } },
      });
      if (active)
        fail("AGE_CREDENTIAL_STILL_ACTIVE", "Credential hiện tại vẫn còn hiệu lực. Hãy thu hồi hoặc chờ hết hạn trước khi yêu cầu cấp lại.");
      return minimalAgeRequest(await tx.ageCredentialRequest.create({ data: { userId: user.id } }));
    });
  });
  app.get("/api/admin/age-credential-requests", async (req) => {
    issuerOperator(req);
    return (await db.ageCredentialRequest.findMany({
      include: {
        user: { select: { id: true, name: true, email: true } },
        operator: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    })).map(effectiveAgeRequest);
  });
  app.patch("/api/admin/age-credential-requests/:id", async (req) => {
    const operator = issuerOperator(req);
    const requestId = id(req);
    const body = z.object({
      action: z.enum(["APPROVE", "REJECT", "REVOKE"]),
      recordChecked: z.boolean().optional(),
      evidenceRevision: z.number().int().nonnegative().optional(),
      reason: z.string().trim().max(300).optional(),
    }).strict().parse(req.body);
    if (body.action === "APPROVE" && body.recordChecked !== true)
      fail("SIMULATED_RECORD_CHECK_REQUIRED", "Vui lòng xác nhận đã đối chiếu hồ sơ ngoài hệ thống.", 400);
    if ((body.action === "REJECT" || body.action === "REVOKE") && !body.reason)
      fail("REASON_REQUIRED", "Cần nhập lý do.", 400);
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AgeCredentialRequest" WHERE id=${requestId}::uuid FOR UPDATE`;
      const current = await tx.ageCredentialRequest.findUnique({ where: { id: requestId } });
      if (!current) fail("REQUEST_NOT_FOUND", "Không tìm thấy yêu cầu.", 404);
      const allowed =
        (body.action === "APPROVE" && current.status === "PENDING") ||
        (body.action === "REJECT" && ["PENDING", "APPROVED"].includes(current.status)) ||
        (body.action === "REVOKE" && current.status === "ISSUED");
      if (!allowed)
        fail("AGE_REQUEST_TRANSITION_INVALID", `Không thể ${body.action} từ trạng thái ${current.status}.`);
      if (body.action === "APPROVE") {
        if (!current.verificationMethod || !current.recordSubmittedAt || !current.consentAt)
          fail("RECORD_REQUIRED", "Khách hàng chưa cung cấp phương thức hoặc hồ sơ.", 409);
        if (body.evidenceRevision !== current.evidenceRevision)
          fail("RECORD_CHANGED", "Hồ sơ đã thay đổi. Vui lòng xem lại.", 409);
        if (current.verificationMethod === "ELECTRONIC" && !await tx.ageVerificationEvidence.findFirst({where:{requestId,ownerUserId:current.userId,deletedAt:null}}))
          fail("RECORD_REQUIRED", "Không có hồ sơ đang hoạt động.", 409);
        await tx.ageVerificationEvidence.updateMany({where:{requestId,deletedAt:null},data:{reviewedAt:new Date()}});
      }
      const now = new Date();
      const next = body.action === "APPROVE" ? "APPROVED" : body.action === "REJECT" ? "REJECTED" : "REVOKED";
      const updated = await tx.ageCredentialRequest.update({
        where: { id: requestId },
        data: {
          status: next,
          recordReviewedAt: body.action === "APPROVE" ? now : current.recordReviewedAt,
          operatorId: operator.id,
          reviewedAt: body.action === "REVOKE" ? current.reviewedAt : now,
          revokedAt: body.action === "REVOKE" ? now : null,
          revocationReason: body.reason ?? null,
          issuerKeyId: current.issuerKeyId,
          circuitVersion: 1,
        },
      });
      await tx.auditLog.create({
        data: { actorId: operator.id, action: `AGE_REQUEST_${body.action}`, objectId: requestId },
      });
      return updated;
    });
  });
  app.get("/api/admin/products", async (req) => {
    actor(req, true);
    return db.product.findMany({
      include: { category: true },
      orderBy: { name: "asc" },
    });
  });
  app.get("/api/admin/users", async (req) => {
    actor(req, true);
    return db.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
        _count: { select: { addresses: true, orders: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });
  app.post("/api/admin/products", async (req) => {
    const u = actor(req, true),
      b = productSchema.parse(req.body);
    return db.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: { ...b, price: BigInt(b.price) },
      });
      await tx.inventoryMovement.create({
        data: { productId: p.id, delta: p.stock, reason: "ADMIN_INITIAL" },
      });
      await tx.auditLog.create({
        data: { actorId: u.id, action: "PRODUCT_CREATE", objectId: p.id },
      });
      return p;
    });
  });
  app.patch("/api/admin/products/:id", async (req) => {
    const u = actor(req, true),
      pid = id(req),
      b = productSchema.parse(req.body);
    return db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Product" WHERE id=${pid}::uuid FOR UPDATE`;
      const old = await tx.product.findUniqueOrThrow({ where: { id: pid } });
      const p = await tx.product.update({
        where: { id: pid },
        data: { ...b, price: BigInt(b.price) },
      });
      if (p.stock !== old.stock)
        await tx.inventoryMovement.create({
          data: {
            productId: pid,
            delta: p.stock - old.stock,
            reason: "ADMIN_ADJUST",
          },
        });
      await tx.auditLog.create({
        data: { actorId: u.id, action: "PRODUCT_UPDATE", objectId: pid },
      });
      return p;
    });
  });
  app.delete("/api/admin/products/:id", async (req) => {
    actor(req, true);
    return db.product.update({
      where: { id: id(req) },
      data: { published: false },
    });
  });
  app.get("/api/admin/categories", async (req) => {
    actor(req, true);
    return db.category.findMany({ orderBy: { name: "asc" } });
  });
  app.post("/api/admin/categories", async (req) => {
    actor(req, true);
    return db.category.create({ data: categorySchema.parse(req.body) });
  });
  app.patch("/api/admin/categories/:id", async (req) => {
    actor(req, true);
    return db.category.update({
      where: { id: id(req) },
      data: categorySchema.parse(req.body),
    });
  });
  app.delete("/api/admin/categories/:id", async (req) => {
    actor(req, true);
    await db.category.delete({ where: { id: id(req) } });
    return { ok: true };
  });
  app.get("/api/admin/lots", async (req) => {
    actor(req, true);
    return db.lot.findMany({
      include: {
        product: { select: { name: true } },
        credentials: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, expiresAt: true },
        },
      },
      orderBy: { lotCode: "asc" },
    });
  });
  app.post("/api/admin/lots", async (req) => {
    actor(req, true);
    const body = lotSchema.parse(req.body);
    if (body.status !== "DRAFT")
      fail("LOT_INITIAL_STATUS", "Lô mới phải bắt đầu ở trạng thái DRAFT.", 400);
    return db.lot.create({ data: body });
  });
  app.patch("/api/admin/lots/:id", async (req) => {
    actor(req, true);
    const b = lotSchema.parse(req.body);
    const old = await db.lot.findUniqueOrThrow({ where: { id: id(req) } });
    if (b.productId !== old.productId)
      fail("LOT_BINDING_IMMUTABLE", "Không được đổi sản phẩm của lô.");
    const allowedTransitions: Record<string, string[]> = {
      DRAFT: ["DRAFT", "ACTIVE", "ARCHIVED"],
      ACTIVE: ["ACTIVE", "ARCHIVED"],
      PENDING: ["ACTIVE", "ARCHIVED"],
      STALE: ["ACTIVE", "ARCHIVED"],
      EXPIRED: ["ACTIVE", "ARCHIVED"],
      REVOKED: ["ACTIVE", "ARCHIVED"],
      ARCHIVED: ["ARCHIVED"],
    };
    if (!allowedTransitions[old.status]?.includes(b.status))
      fail("LOT_TRANSITION_INVALID", `Không thể chuyển ${old.status} → ${b.status}.`);
    return db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Lot" WHERE id=${old.id}::uuid FOR UPDATE`;
        const locked=await tx.lot.findUniqueOrThrow({where:{id:old.id}});
        if(!allowedTransitions[locked.status]?.includes(b.status))fail("LOT_TRANSITION_INVALID","Lô đã đổi trạng thái; tải lại trước khi sửa.");
        if (b.lotCode !== locked.lotCode) {
        await tx.lotProof.updateMany({
          where: { lotId: old.id },
          data: { status: "STALE" },
        });
        await tx.lotCredential.updateMany({
          where: { lotId: old.id, status: "ACTIVE" },
          data: { status: "SUPERSEDED" },
        });
      }
      return tx.lot.update({
        where: { id: old.id },
        data: { lotCode: b.lotCode, status: b.status, stock: b.stock },
      });
    });
  });
  app.delete("/api/admin/lots/:id", async (req) => {
    actor(req, true);
    return db.lot.update({
      where: { id: id(req) },
      data: { status: "ARCHIVED" },
    });
  });
  app.post("/api/admin/lots/:id/proof-bundle", async (req) => {
    const u = actor(req, true);
    return lotProofs.importProof(id(req), req.body, u.id);
  });
  app.post("/api/admin/lots/:id/revoke", async (req) => {
    const u = actor(req, true);
    const body = z.object({ reason: str(300) }).strict().parse(req.body);
    return lotProofs.revoke(id(req), u.id, body.reason);
  });
  app.get("/api/admin/orders", async (req) => {
    actor(req, true);
    return db.order.findMany({
      include: { ...orderInclude, user: { select: { email: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });
  app.patch("/api/admin/orders/:id/status", async (req) => {
    const u = actor(req, true);
    const b = z
      .object({
        status: z.enum(["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"]),
      })
      .strict()
      .parse(req.body);
    return transition(db, id(req), b.status, u);
  });
  await app.ready();
  return app;
}
