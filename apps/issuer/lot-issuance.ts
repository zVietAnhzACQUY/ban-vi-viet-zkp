import type { PrismaClient } from "../api/generated/client/index.js";
import { LOT_ISSUER_ID } from "../shared/g4.js";
export async function claimLotIssuance(db:PrismaClient,input:{requestId:string;credentialId:string;issuedAt:Date;expiresAt:Date}) {
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "LotCredentialRequest" WHERE id=${input.requestId}::uuid FOR UPDATE`;
    const r=await tx.lotCredentialRequest.findUnique({where:{id:input.requestId}});
    if(!r||r.status!=="APPROVED"||!r.operatorId||r.operatorId===r.userId||!r.recordReviewedAt||!r.recordSubmittedAt||!r.consentAt||r.credentialId)throw new Error("LOT request must be APPROVED with completed independent review.");
    await tx.$queryRaw`SELECT id FROM "Lot" WHERE id=${r.lotId}::uuid FOR UPDATE`;
    const l=await tx.lot.findUnique({where:{id:r.lotId}});
    if(!l||l.status==="ARCHIVED"||l.productId!==r.productId||l.lotCode!==r.lotCode)throw new Error("LOT request binding changed.");
    const evidence=await tx.lotVerificationEvidence.findFirst({where:{requestId:r.id,ownerUserId:r.userId,reviewedAt:{not:null},deletedAt:null}});
    if(!evidence||input.issuedAt>=input.expiresAt)throw new Error("LOT issuance prerequisites invalid.");
    return tx.lotCredentialRequest.update({where:{id:r.id},data:{status:"ISSUING",credentialId:input.credentialId,issuedAt:input.issuedAt,expiresAt:input.expiresAt,issuerKeyId:`${LOT_ISSUER_ID}:v1`}});
  });
}
export async function finalizeLotIssuance(db:PrismaClient,requestId:string,credentialId:string) {
  return db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "LotCredentialRequest" WHERE id=${requestId}::uuid FOR UPDATE`;
    const r=await tx.lotCredentialRequest.findUnique({where:{id:requestId}});
    if(!r||r.credentialId!==credentialId||!r.operatorId)throw new Error("LOT issuance claim invalid.");
    if(r.status==="ISSUED")return; // Recovery after commit/connection loss is idempotent.
    if(r.status!=="ISSUING")throw new Error("LOT request is no longer ISSUING.");
    await tx.$queryRaw`SELECT id FROM "Lot" WHERE id=${r.lotId}::uuid FOR UPDATE`;
    const l=await tx.lot.findUnique({where:{id:r.lotId}});
    if(!l||l.status==="ARCHIVED"||l.productId!==r.productId||l.lotCode!==r.lotCode)throw new Error("LOT request binding changed; manual recovery required.");
    await tx.lotCredentialRequest.update({where:{id:requestId},data:{status:"ISSUED"}});
    await tx.auditLog.create({data:{actorId:r.operatorId,action:"LOT_CREDENTIAL_ISSUED_BY_CLI",objectId:requestId}});
  });
}
// Only used when exclusive file creation failed and no credential was persisted.
export async function releaseLotIssuance(db:PrismaClient,requestId:string,credentialId:string) {
  const r=await db.lotCredentialRequest.updateMany({where:{id:requestId,status:"ISSUING",credentialId},data:{status:"APPROVED",credentialId:null,issuedAt:null,expiresAt:null,issuerKeyId:null}});
  if(r.count!==1)throw new Error("LOT claim requires manual recovery.");
}
