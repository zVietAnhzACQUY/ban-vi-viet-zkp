import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../api/generated/client/index.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { fail } from "../api/src/commerce.js";
import { MAX_EVIDENCE_BYTES, inspectEvidence, saveEvidence, openEvidence, removeEvidence, type EvidenceStorage } from "./evidence-storage.js";
export async function registerEvidence(app:FastifyInstance,db:PrismaClient,storage:EvidenceStorage) {
  app.addContentTypeParser("application/octet-stream",{parseAs:"buffer",bodyLimit:MAX_EVIDENCE_BYTES},(_req,body,done)=>done(null,body));
  const requestId=(req:any)=>z.string().uuid().parse(req.params.id);
  const user=(req:any,operator=false)=>{ if(!req.actor) fail("LOGIN_REQUIRED","Vui lòng đăng nhập.",401); if(req.actor.role !== (operator?"ISSUER_OPERATOR":"CUSTOMER")) fail("FORBIDDEN","Không đủ quyền truy cập.",403); return req.actor; };
  const ownership=async(req:any)=>{ const owner=user(req); const r=await db.ageCredentialRequest.findFirst({where:{id:requestId(req),userId:owner.id}}); if(!r) fail("NOT_FOUND","Không tìm thấy yêu cầu.",404); return r; };
  const view=(r:any)=>({id:r.id,status:r.status,createdAt:r.createdAt,verificationMethod:r.verificationMethod,recordSubmittedAt:r.recordSubmittedAt,recordReviewedAt:r.recordReviewedAt,evidenceRevision:r.evidenceRevision});
  app.get("/issuer/age/requests/:id/submission",async req=>view(await ownership(req)));
  app.post("/issuer/age/requests/:id/submission",{bodyLimit:MAX_EVIDENCE_BYTES,onRequest:async req=>{await ownership(req);},config:{rateLimit:{max:10,timeWindow:"1 minute"}}},async req=>{
    const owner=user(req), id=requestId(req);
    const upload=Buffer.isBuffer(req.body);
    const body=upload? z.object({method:z.literal("ELECTRONIC"),consent:z.literal(true),revision:z.coerce.number().int().nonnegative(),name:z.string()}).parse({method:"ELECTRONIC",consent:req.headers["x-evidence-consent"]==="true",revision:req.headers["x-evidence-revision"],name:req.headers["x-evidence-name"]?decodeURIComponent(String(req.headers["x-evidence-name"])):""})
      :z.object({method:z.enum(["IN_PERSON","EXTERNAL"]),consent:z.literal(true),revision:z.number().int().nonnegative(),reference:z.string().max(100).regex(/^FICTIONAL-[A-Za-z0-9_-]+$/).optional()}).strict().parse(req.body);
    if(body.method==="EXTERNAL" && !("reference" in body && body.reference)) fail("REFERENCE_REQUIRED","Cần mã tham chiếu hư cấu bắt đầu bằng FICTIONAL-.",400);
    let metadata:ReturnType<typeof inspectEvidence>|undefined;
    if(upload) { try { metadata=inspectEvidence(req.body as Buffer,(body as any).name); } catch { fail("INVALID_FILE","Chỉ chấp nhận PDF, JPG hoặc PNG hợp lệ, tối đa 5 MB và tên không có phần mở rộng kép.",400); } }
    const storageKey=randomUUID(); let written=false;
    try {
      return await db.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM "AgeCredentialRequest" WHERE id=${id}::uuid FOR UPDATE`;
        const r=await tx.ageCredentialRequest.findFirst({where:{id,userId:owner.id}});
        if(!r) fail("NOT_FOUND","Không tìm thấy yêu cầu.",404);
        if(r.status!=="PENDING" || r.recordReviewedAt || r.evidenceRevision!==body.revision) fail("RECORD_CHANGED","Hồ sơ đã thay đổi hoặc đã được xử lý. Vui lòng tải lại.",409);
        // Replacement is intentionally disabled: no silent destruction of submitted records.
        if(r.recordSubmittedAt) fail("ALREADY_SUBMITTED","Hồ sơ đã được tiếp nhận; liên hệ nhân viên để xử lý.",409);
        if(metadata) { await saveEvidence(storage,storageKey,req.body as Buffer); written=true; await tx.ageVerificationEvidence.create({data:{requestId:id,ownerUserId:owner.id,storageKey,...metadata}}); }
        const now=new Date(); const updated=await tx.ageCredentialRequest.update({where:{id},data:{verificationMethod:body.method,fictionalReference:"reference" in body ? body.reference : null,recordSubmittedAt:now,consentAt:now,evidenceRevision:{increment:1}}});
        await tx.auditLog.create({data:{actorId:owner.id,action:"AGE_RECORD_SUBMITTED",objectId:id}});
        return view(updated);
      });
    } catch(error) { if(written) await removeEvidence(storage,storageKey); throw error; }
  });
  app.get("/issuer/age/operator/requests/:id/evidence",async req=>{
    user(req,true); const id=requestId(req); const r=await db.ageCredentialRequest.findUnique({where:{id},include:{evidence:{where:{deletedAt:null},select:{id:true,originalName:true,detectedMimeType:true,size:true,createdAt:true}}}});
    if(!r) fail("NOT_FOUND","Không tìm thấy yêu cầu.",404);
    return {...view(r),files:r.evidence};
  });
  // POST rather than a navigable URL: Origin+CSRF are mandatory for decrypting a file.
  app.post("/issuer/age/operator/requests/:id/file",async(req,reply)=>{
    user(req,true); const id=requestId(req);
    const data=await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "AgeCredentialRequest" WHERE id=${id}::uuid FOR UPDATE`;
      const evidence=await tx.ageVerificationEvidence.findFirst({where:{requestId:id,deletedAt:null}});
      if(!evidence) fail("NOT_FOUND","Không có hồ sơ đang hoạt động.",404);
      return {bytes:await openEvidence(storage,evidence.storageKey),mime:evidence.detectedMimeType};
    });
    return reply.header("Cache-Control","no-store").header("Content-Disposition",'attachment; filename="fictional-age-record"').type(data.mime).send(Readable.from([data.bytes]));
  });
}
