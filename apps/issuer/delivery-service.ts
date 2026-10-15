import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z, ZodError } from "zod";
import type { PrismaClient } from "../api/generated/client/index.js";
import { AppError, fail, hash } from "../api/src/commerce.js";
import { ageCredentialFileSchema } from "../shared/age-wallet.js";
import { openAgeCredential } from "./delivery-crypto.js";
import { registerEvidence } from "./evidence-service.js";
import type { EvidenceStorage } from "./evidence-storage.js";
import { registerLotRequests } from "./lot-request-service.js";

export const CLAIM_TTL_MS = 5 * 60 * 1000;
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const uuid = z.string().uuid();

const safeEqual = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function createDeliveryApp(
  db: PrismaClient,
  options: {
    encryptionKey: Buffer;
    portalOrigin?: string;
    walletOrigin?: string;
    websiteOrigin?: string;
    now?: () => Date;
    evidenceStorage?: EvidenceStorage;
  },
) {
  const app = Fastify({ logger: false, bodyLimit: 4096 });
  const portalOrigin = options.portalOrigin || "http://127.0.0.1:5175";
  const walletOrigin = options.walletOrigin || "http://127.0.0.1:5174";
  const websiteOrigin = options.websiteOrigin || "http://127.0.0.1:5173";
  const now = options.now || (() => new Date());
  await app.register(cookie);
  await app.register(rateLimit, { global: true, max: 60, timeWindow: "1 minute" });
  app.decorateRequest("actor", null);

  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("Cache-Control", "no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer");
    const businessStatus = /^\/issuer\/lot\/requests(?:\?[^]*)?$/.test(req.url) || /^\/issuer\/lot\/requests\/[a-f0-9-]+(?:\?[^]*)?$/.test(req.url);
    const allowed = req.url.startsWith("/issuer/csrf")
      ? req.headers.origin === walletOrigin ? walletOrigin : req.headers.origin === websiteOrigin ? websiteOrigin : portalOrigin
      : businessStatus && req.headers.origin === websiteOrigin ? websiteOrigin
      : req.url.includes("/redeem") || req.url.includes("/ack")
        ? walletOrigin
        : portalOrigin;
    if (req.headers.origin === allowed)
      reply
        .header("Access-Control-Allow-Origin", allowed)
        .header("Access-Control-Allow-Credentials", "true")
        .header("Vary", "Origin");
    if (req.method === "OPTIONS") {
      if (req.headers.origin !== allowed)
        fail("ORIGIN_NOT_ALLOWED", "Nguồn yêu cầu không hợp lệ.", 403);
      return reply
        .header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        .header("Access-Control-Allow-Headers", "content-type,x-csrf-token,x-evidence-consent,x-evidence-revision,x-evidence-name")
        .code(204)
        .send();
    }
    if (req.headers.origin !== allowed)
      fail("ORIGIN_NOT_ALLOWED", "Nguồn yêu cầu không hợp lệ.", 403);
    const csrf = req.headers["x-csrf-token"];
    const operatorContext=req.url.startsWith("/issuer/age/operator/")||req.url.startsWith("/issuer/lot/operator/")||req.url.startsWith("/issuer/operator/csrf");
    const expected = operatorContext?req.cookies.issuer_csrf:req.cookies.bvv_csrf;
    if (
      req.method !== "GET" &&
      (typeof csrf !== "string" ||
        !expected ||
        !/^[0-9a-f]{64}$/.test(csrf) ||
        !safeEqual(csrf, expected))
    )
      fail("CSRF_TOKEN", "Phiên bảo vệ không hợp lệ.", 403);
    const sessionToken = operatorContext?req.cookies.issuer_session:req.cookies.bvv_session;
    if (sessionToken && /^[0-9a-f]{64}$/.test(sessionToken)) {
      const session = await db.session.findUnique({
        where: { id: hash((operatorContext?"issuer:":"")+sessionToken) },
        include: { user: true },
      });
      if (session && session.expiresAt > now() && (operatorContext || session.user.role!=="ISSUER_OPERATOR"))
        (req as any).actor = { id: session.user.id, role: session.user.role };
    }
  });
  app.options("/*", async (_req, reply) => reply.code(204).send());
  app.setErrorHandler((error, _req, reply) => {
    if ((error as any).statusCode === 413) return reply.code(413).send({code:"FILE_TOO_LARGE",message:"Tệp vượt quá giới hạn 5 MB."});
    if ((error as any).statusCode === 429) return reply.code(429).send({code:"RATE_LIMITED",message:"Có quá nhiều yêu cầu. Vui lòng thử lại sau."});
    if (error instanceof ZodError)
      return reply.code(400).send({ code: "VALIDATION_ERROR", message: "Dữ liệu không hợp lệ." });
    if (error instanceof AppError)
      return reply.code(error.statusCode).send({ code: error.code, message: error.message });
    return reply.code(500).send({ code: "DELIVERY_FAILED", message: "Không thể xử lý yêu cầu nhận credential." });
  });
  const actor = (req: any) => {
    if (!req.actor) fail("LOGIN_REQUIRED", "Vui lòng đăng nhập đúng tài khoản.", 401);
    return req.actor as { id: string; role: string };
  };

  app.get("/issuer/csrf", async (req, reply) => {
    const value =
      req.cookies.bvv_csrf && /^[0-9a-f]{64}$/.test(req.cookies.bvv_csrf)
        ? req.cookies.bvv_csrf
        : randomBytes(32).toString("hex");
    reply.setCookie("bvv_csrf", value, {
      path: "/",
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      maxAge: 86400,
    });
    return { token: value };
  });
  app.get("/issuer/operator/csrf",async(req,reply)=>{
    const value=req.cookies.issuer_csrf && /^[0-9a-f]{64}$/.test(req.cookies.issuer_csrf)?req.cookies.issuer_csrf:randomBytes(32).toString("hex");
    reply.setCookie("issuer_csrf",value,{path:"/",httpOnly:true,sameSite:"strict",secure:process.env.NODE_ENV==="production",maxAge:86400});return {token:value};
  });

  app.post("/issuer/age/claims", async (req) => {
    const user = actor(req);
    const { requestId } = z.object({ requestId: uuid }).strict().parse(req.body);
    const token = randomBytes(32).toString("base64url");
    const createdAt = now();
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AgeCredentialRequest" WHERE id=${requestId}::uuid FOR UPDATE`;
      const request = await tx.ageCredentialRequest.findUnique({ where: { id: requestId } });
      if (
        !request || request.userId !== user.id || request.status !== "ISSUED" ||
        !request.credentialId || request.revokedAt ||
        (request.expiresAt && request.expiresAt <= createdAt)
      )
        fail("CREDENTIAL_NOT_DELIVERABLE", "Credential chưa sẵn sàng để nhận.", 409);
      const delivery = await tx.ageCredentialDelivery.findUnique({ where: { requestId } });
      if (!delivery || delivery.userId !== user.id || delivery.credentialId !== request.credentialId)
        fail("DELIVERY_NOT_FOUND", "Issuer chưa chuẩn bị gói nhận credential.", 409);
      await tx.$queryRaw`SELECT id FROM "AgeCredentialDelivery" WHERE id=${delivery.id}::uuid FOR UPDATE`;
      if (await tx.ageCredentialClaim.findFirst({ where: {
        requestId, userId: user.id, credentialId: request.credentialId,
        credentialType: "AGE", status: "CLAIMED", claimedAt: { not: null },
      }, select: { id: true } }))
        fail("CREDENTIAL_ALREADY_CLAIMED", "Credential đã được nhận vào Ví.", 409);
      if (await tx.ageCredentialClaim.findFirst({ where: {
        requestId, userId: user.id, credentialId: request.credentialId,
        credentialType: "AGE", status: "ACTIVE", expiresAt: { gt: createdAt },
      }, select: { id: true } }))
        fail("CLAIM_ALREADY_ACTIVE", "Một phiên nhận credential đang còn hiệu lực.", 409);
      await tx.ageCredentialClaim.create({
        data: {
          deliveryId: delivery.id,
          requestId,
          userId: user.id,
          credentialId: request.credentialId,
          credentialType: "AGE",
          tokenHash: tokenHash(token),
          status: "ACTIVE",
          expiresAt: new Date(createdAt.getTime() + CLAIM_TTL_MS),
          createdAt,
        },
      });
    }, { maxWait: 10_000, timeout: 10_000 });
    return { claimUrl: `${walletOrigin}/?claim=${encodeURIComponent(token)}`, expiresAt: new Date(createdAt.getTime() + CLAIM_TTL_MS).toISOString() };
  });

  async function claimFor(req: any) {
    const user = actor(req);
    const { token } = z.object({ token: tokenSchema }).strict().parse(req.body);
    const claim = await db.ageCredentialClaim.findUnique({
      where: { tokenHash: tokenHash(token) },
    });
    if (!claim || claim.userId !== user.id || claim.credentialType !== "AGE")
      fail("CLAIM_INVALID", "Liên kết nhận không hợp lệ cho tài khoản này.", 403);
    return { claim, user, token };
  }

  app.post("/issuer/age/claims/redeem", async (req) => {
    const { claim } = await claimFor(req);
    if (claim.status !== "ACTIVE") fail("CLAIM_REPLAYED", "Liên kết đã được sử dụng.", 409);
    if (claim.expiresAt <= now()) fail("CLAIM_EXPIRED", "Liên kết nhận đã hết hạn.", 410);
    const [request, delivery] = await Promise.all([
      db.ageCredentialRequest.findUnique({ where: { id: claim.requestId } }),
      db.ageCredentialDelivery.findUnique({ where: { id: claim.deliveryId } }),
    ]);
    if (
      !request || !delivery || request.status !== "ISSUED" || request.revokedAt ||
      request.userId !== claim.userId || request.credentialId !== claim.credentialId ||
      delivery.userId !== claim.userId || delivery.credentialId !== claim.credentialId
    )
      fail("CREDENTIAL_BINDING_INVALID", "Credential không còn hợp lệ để nhận.", 409);
    const credential = openAgeCredential(
      { ciphertext: delivery.ciphertext, iv: delivery.iv, authTag: delivery.authTag, keyVersion: delivery.keyVersion as 1 },
      options.encryptionKey,
    );
    const parsed = ageCredentialFileSchema.parse(credential);
    if (parsed.metadata.credentialId !== claim.credentialId)
      fail("CREDENTIAL_BINDING_INVALID", "Credential không khớp yêu cầu.", 409);
    return { credential: parsed, credentialType: "AGE", credentialId: claim.credentialId };
  });

  app.post("/issuer/age/claims/ack", async (req) => {
    const { claim } = await claimFor(req);
    if (claim.status === "CLAIMED") return { status: "CLAIMED", idempotent: true };
    if (claim.expiresAt <= now()) fail("CLAIM_EXPIRED", "Liên kết nhận đã hết hạn.", 410);
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AgeCredentialClaim" WHERE id=${claim.id}::uuid FOR UPDATE`;
      const locked = await tx.ageCredentialClaim.findUniqueOrThrow({ where: { id: claim.id } });
      if (locked.userId !== claim.userId || locked.credentialId !== claim.credentialId)
        fail("CLAIM_CHANGED", "Liên kết nhận đã thay đổi.", 409);
      if (locked.status === "CLAIMED") return;
      if (locked.status !== "ACTIVE" || locked.expiresAt <= now())
        fail("CLAIM_EXPIRED", "Liên kết nhận không còn hiệu lực.", 410);
      const [request, delivery] = await Promise.all([
        tx.ageCredentialRequest.findUnique({ where: { id: locked.requestId } }),
        tx.ageCredentialDelivery.findUnique({ where: { id: locked.deliveryId } }),
      ]);
      if (
        !request || !delivery || request.status !== "ISSUED" || request.revokedAt ||
        request.userId !== locked.userId || request.credentialId !== locked.credentialId ||
        delivery.userId !== locked.userId || delivery.credentialId !== locked.credentialId
      )
        fail("CREDENTIAL_BINDING_INVALID", "Credential không còn hợp lệ để xác nhận.", 409);
      await tx.ageCredentialClaim.update({
        where: { id: locked.id },
        data: { status: "CLAIMED", claimedAt: now() },
      });
    });
    return { status: "CLAIMED", idempotent: false };
  });

  if (options.evidenceStorage) {
    await registerEvidence(app,db,options.evidenceStorage);
    await registerLotRequests(app,db,options.evidenceStorage);
  }
  await app.ready();
  return app;
}
