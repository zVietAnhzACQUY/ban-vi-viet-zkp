import type { PrismaClient } from "../api/generated/client/index.js";
import { removeEvidence, type EvidenceStorage } from "./evidence-storage.js";
export async function cleanupAgeEvidence(db:PrismaClient,storage:EvidenceStorage,options:{apply?:boolean;now?:Date;retentionHours?:number}={}) {
  const hours=options.retentionHours ?? 24;
  if(!Number.isFinite(hours)||hours<1||hours>168) throw new Error("Retention must be 1–168 hours.");
  const cutoff=new Date((options.now??new Date()).getTime()-hours*3600000);
  const candidates=await db.ageVerificationEvidence.findMany({where:{deletedAt:null,request:{status:{in:["ISSUED","REJECTED","REVOKED"]},updatedAt:{lte:cutoff}}},select:{id:true,requestId:true}});
  let removed=0;
  if(options.apply) for(const candidate of candidates) await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT id FROM "AgeCredentialRequest" WHERE id=${candidate.requestId}::uuid FOR UPDATE`;
    const evidence=await tx.ageVerificationEvidence.findUnique({where:{id:candidate.id},include:{request:true}});
    if(!evidence||evidence.deletedAt||!(["ISSUED","REJECTED","REVOKED"] as string[]).includes(evidence.request.status)||evidence.request.updatedAt>cutoff) return;
    // Missing file is accepted on retry after crash between unlink and metadata commit.
    await removeEvidence(storage,evidence.storageKey);
    await tx.ageVerificationEvidence.update({where:{id:evidence.id},data:{deletedAt:options.now??new Date(),originalName:"deleted"}});
    removed++;
  });
  return {dryRun:!options.apply,eligible:candidates.length,removed};
}
