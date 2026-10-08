import type { PrismaClient } from "../api/generated/client/index.js";
import { removeEvidence, type EvidenceStorage } from "./evidence-storage.js";
export async function cleanupLotEvidence(db:PrismaClient,storage:EvidenceStorage,options:{apply?:boolean;now?:Date;retentionHours?:number}={}) {
  const hours=options.retentionHours??24;if(!Number.isFinite(hours)||hours<1||hours>168)throw new Error("Retention must be 1–168 hours.");
  const now=options.now??new Date(),cutoff=new Date(now.getTime()-hours*3600000),terminal=["ISSUED","REJECTED","REVOKED","EXPIRED"] as const;
  const rows=await db.lotVerificationEvidence.findMany({where:{deletedAt:null,request:{status:{in:[...terminal]},updatedAt:{lte:cutoff}}},select:{id:true,requestId:true}});let removed=0;
  if(options.apply)for(const row of rows)await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "LotCredentialRequest" WHERE id=${row.requestId}::uuid FOR UPDATE`;
    const e=await tx.lotVerificationEvidence.findUnique({where:{id:row.id},include:{request:true}});
    if(!e||e.deletedAt||!(terminal as readonly string[]).includes(e.request.status)||e.request.updatedAt>cutoff)return;
    await removeEvidence(storage,e.storageKey,"LOT");await tx.lotVerificationEvidence.update({where:{id:e.id},data:{deletedAt:now,originalName:"deleted"}});removed++;
  });return {dryRun:!options.apply,eligible:rows.length,removed};
}
