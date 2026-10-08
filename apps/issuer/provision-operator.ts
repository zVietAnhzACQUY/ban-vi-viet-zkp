import argon2 from "argon2";
import type { PrismaClient } from "../api/generated/client/index.js";

export async function provisionOperator(db: PrismaClient, email: string, password: string | undefined, reset = false) {
  if (email === "admin@banviviet.demo" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("EMAIL_NOT_ALLOWED");
  return db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"issuer-operator:" + email}))`;
    const existing = await tx.user.findUnique({where:{email},select:{id:true,role:true}});
    if (existing && existing.role !== "ISSUER_OPERATOR") throw new Error("EXISTING_ROLE_CONFLICT");
    if (existing && !reset) return {id:existing.id,created:false,reset:false};
    if (!password || password.length < 12 || password.length > 128) throw new Error("PASSWORD_LENGTH");
    const passwordHash = await argon2.hash(password,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1});
    const user = existing ? await tx.user.update({where:{id:existing.id},data:{passwordHash},select:{id:true}})
      : await tx.user.create({data:{email,name:"Nhân viên xác minh",role:"ISSUER_OPERATOR",passwordHash},select:{id:true}});
    if (existing) await tx.session.updateMany({where:{userId:user.id},data:{expiresAt:new Date(0)}});
    await tx.auditLog.create({data:{actorId:user.id,objectId:user.id,action:existing?"ISSUER_OPERATOR_PASSWORD_RESET":"ISSUER_OPERATOR_ACCOUNT_CREATED"}});
    return {id:user.id,created:!existing,reset:!!existing};
  }, {timeout:15000});
}
