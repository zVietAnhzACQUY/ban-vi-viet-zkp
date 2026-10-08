import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "../api/generated/client/index.js";
import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { fail } from "../api/src/commerce.js";
import { inspectEvidence, saveEvidence, openEvidence, removeEvidence, MAX_EVIDENCE_BYTES, type EvidenceStorage } from "./evidence-storage.js";

const openStatuses = ["PENDING_EVIDENCE", "PENDING_REVIEW", "APPROVED", "ISSUING"] as const;
const fields = { id:true,userId:true,lotId:true,productId:true,lotCode:true,status:true,createdAt:true,recordSubmittedAt:true,recordReviewedAt:true,evidenceRevision:true,issuedAt:true,expiresAt:true,revokedAt:true,reason:true } as const;
const files = { id:true,originalName:true,detectedMimeType:true,size:true,createdAt:true } as const;
const requestView=<T extends {status:string;expiresAt:Date|null}>(r:T)=>({...r,status:r.status==="ISSUED"&&r.expiresAt&&r.expiresAt<=new Date()?"EXPIRED":r.status});
export async function verifiedLotEvidence(storage:EvidenceStorage,e:{storageKey:string;sha256:string;size:number;detectedMimeType:string;originalName:string}) {
  const bytes=await openEvidence(storage,e.storageKey,"LOT");
  const metadata=inspectEvidence(bytes,e.originalName);
  if(bytes.length!==e.size || metadata.detectedMimeType!==e.detectedMimeType || createHash("sha256").update(bytes).digest("hex")!==e.sha256)
    fail("EVIDENCE_INTEGRITY","Hồ sơ không vượt qua kiểm tra toàn vẹn.",409);
  return bytes;
}
export async function registerLotRequests(app:FastifyInstance,db:PrismaClient,storage:EvidenceStorage) {
  const id=(req:any)=>z.string().uuid().parse(req.params.id);
  const actor=(req:any,operator=false)=>{if(!req.actor)fail("LOGIN_REQUIRED","Vui lòng đăng nhập đúng tài khoản.",401);if(req.actor.role!==(operator?"ISSUER_OPERATOR":"ADMIN"))fail("FORBIDDEN","Không đủ quyền truy cập.",403);return req.actor as {id:string;role:string};};
  const own=async(req:any)=>{const u=actor(req),r=await db.lotCredentialRequest.findFirst({where:{id:id(req),userId:u.id},select:fields});if(!r)fail("NOT_FOUND","Không tìm thấy yêu cầu.",404);return r;};
  const binding=(r:{productId:string;lotCode:string},l:{productId:string;lotCode:string}|null)=>{if(!l||r.productId!==l.productId||r.lotCode!==l.lotCode)fail("LOT_BINDING_CHANGED","Thông tin lô đã thay đổi; không thể tiếp tục yêu cầu cũ.",409);};
  app.get("/issuer/lot/business/me",async req=>{const u=actor(req);return {user:await db.user.findUnique({where:{id:u.id},select:{id:true,name:true,email:true,role:true}})};});
  app.get("/issuer/lot/requests",async req=>(await db.lotCredentialRequest.findMany({where:{userId:actor(req).id},select:fields,orderBy:{createdAt:"desc"},take:200})).map(requestView));
  app.post("/issuer/lot/requests",async req=>{
    const u=actor(req),{lotId}=z.object({lotId:z.string().uuid()}).strict().parse(req.body);
    return db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "Lot" WHERE id=${lotId}::uuid FOR UPDATE`;
      const lot=await tx.lot.findUnique({where:{id:lotId}});if(!lot||lot.status==="ARCHIVED")fail("LOT_UNAVAILABLE","Không tìm thấy lô đang vận hành.",404);
      const existing=await tx.lotCredentialRequest.findFirst({where:{lotId,status:{in:[...openStatuses]}}});
      if(existing){if(existing.userId!==u.id)fail("OPEN_REQUEST_EXISTS","Lô đã có yêu cầu đang xử lý.",409);return tx.lotCredentialRequest.findUnique({where:{id:existing.id},select:fields});}
      const r=await tx.lotCredentialRequest.create({data:{userId:u.id,lotId,productId:lot.productId,lotCode:lot.lotCode},select:fields});
      await tx.auditLog.create({data:{actorId:u.id,action:"LOT_REQUEST_CREATED",objectId:r.id}});return r;
    });
  });
  app.get("/issuer/lot/requests/:id",async req=>requestView(await own(req)));
  app.post("/issuer/lot/requests/:id/submission",{bodyLimit:MAX_EVIDENCE_BYTES,onRequest:async req=>{await own(req);},config:{rateLimit:{max:10,timeWindow:"1 minute"}}},async req=>{
    const u=actor(req),requestId=id(req);
    if(!Buffer.isBuffer(req.body))fail("FILE_REQUIRED","Cần một tệp hồ sơ PDF, JPG hoặc PNG.",400);
    const body=z.object({consent:z.literal(true),revision:z.coerce.number().int().nonnegative(),name:z.string()}).strict().parse({consent:req.headers["x-evidence-consent"]==="true",revision:req.headers["x-evidence-revision"],name:decodeURIComponent(String(req.headers["x-evidence-name"]||""))});
    let metadata:ReturnType<typeof inspectEvidence>;try{metadata=inspectEvidence(req.body as Buffer,body.name);}catch{fail("INVALID_FILE","Chỉ nhận PDF, JPG hoặc PNG hợp lệ, tối đa 5 MB.",400);}
    const storageKey=randomUUID();let written=false;
    try{return await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "LotCredentialRequest" WHERE id=${requestId}::uuid FOR UPDATE`;
      const r=await tx.lotCredentialRequest.findFirst({where:{id:requestId,userId:u.id}});if(!r)fail("NOT_FOUND","Không tìm thấy yêu cầu.",404);
      if(r.status!=="PENDING_EVIDENCE"||r.recordReviewedAt||r.recordSubmittedAt||r.evidenceRevision!==body.revision)fail("RECORD_LOCKED","Hồ sơ đã được tiếp nhận hoặc xử lý; không thể thay thế.",409);
      await tx.$queryRaw`SELECT id FROM "Lot" WHERE id=${r.lotId}::uuid FOR UPDATE`;
      binding(r,await tx.lot.findUnique({where:{id:r.lotId}}));
      await saveEvidence(storage,storageKey,req.body as Buffer,"LOT");written=true;
      await tx.lotVerificationEvidence.create({data:{requestId,ownerUserId:u.id,storageKey,...metadata}});
      const now=new Date(),updated=await tx.lotCredentialRequest.update({where:{id:requestId},data:{status:"PENDING_REVIEW",consentAt:now,recordSubmittedAt:now,evidenceRevision:{increment:1}},select:fields});
      await tx.auditLog.create({data:{actorId:u.id,action:"LOT_RECORD_SUBMITTED",objectId:requestId}});return updated;
    });}catch(error){if(written)await removeEvidence(storage,storageKey,"LOT");throw error;}
  });
  app.get("/issuer/lot/operator/requests",async req=>{actor(req,true);return (await db.lotCredentialRequest.findMany({select:{...fields,user:{select:{email:true}},operatorId:true},orderBy:{createdAt:"desc"},take:200})).map(requestView);});
  app.get("/issuer/lot/operator/requests/:id",async req=>{
    const u=actor(req,true),requestId=id(req);const r=await db.lotCredentialRequest.findUnique({where:{id:requestId},select:{...fields,operatorId:true,user:{select:{email:true}},evidence:{where:{deletedAt:null},select:files}}});
    if(!r)fail("NOT_FOUND","Không tìm thấy yêu cầu.",404);if(r.userId===u.id)fail("SELF_REVIEW","Không được review yêu cầu của chính mình.",403);
    const audit=await db.auditLog.findMany({where:{objectId:requestId,action:{startsWith:"LOT_"}},select:{actorId:true,action:true,createdAt:true},orderBy:{createdAt:"asc"}});return {...requestView(r),audit};
  });
  app.post("/issuer/lot/operator/requests/:id/file",async(req,reply)=>{
    const u=actor(req,true),requestId=id(req);
    const data=await db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "LotCredentialRequest" WHERE id=${requestId}::uuid FOR UPDATE`;
      const r=await tx.lotCredentialRequest.findUnique({where:{id:requestId}});if(!r)fail("NOT_FOUND","Không tìm thấy yêu cầu.",404);if(r.userId===u.id)fail("SELF_REVIEW","Không được review yêu cầu của chính mình.",403);
      const e=await tx.lotVerificationEvidence.findFirst({where:{requestId,deletedAt:null,ownerUserId:r.userId}});if(!e)fail("NOT_FOUND","Không có hồ sơ đang hoạt động.",404);
      return {bytes:await verifiedLotEvidence(storage,e),mime:e.detectedMimeType};
    });return reply.header("Cache-Control","no-store").header("Content-Disposition",'attachment; filename="lot-record"').type(data.mime).send(Readable.from([data.bytes]));
  });
  app.post("/issuer/lot/operator/requests/:id/review",async req=>{
    const u=actor(req,true),requestId=id(req),body=z.discriminatedUnion("action",[
      z.object({action:z.literal("APPROVE"),recordChecked:z.literal(true),evidenceRevision:z.number().int().nonnegative()}).strict(),
      z.object({action:z.enum(["REJECT","REVOKE"]),reason:z.string().trim().min(1).max(300)}).strict(),
    ]).parse(req.body);
    return db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "LotCredentialRequest" WHERE id=${requestId}::uuid FOR UPDATE`;
      const r=await tx.lotCredentialRequest.findUnique({where:{id:requestId}});if(!r)fail("NOT_FOUND","Không tìm thấy yêu cầu.",404);if(r.userId===u.id)fail("SELF_REVIEW","Không được tự xử lý yêu cầu.",403);
      await tx.$queryRaw`SELECT id FROM "Lot" WHERE id=${r.lotId}::uuid FOR UPDATE`;
      if(body.action==="APPROVE"){
        binding(r,await tx.lot.findUnique({where:{id:r.lotId}}));
        if(r.status!=="PENDING_REVIEW"||!r.recordSubmittedAt||!r.consentAt||r.evidenceRevision!==body.evidenceRevision)fail("RECORD_CHANGED","Hồ sơ chưa sẵn sàng hoặc đã thay đổi.",409);
        const e=await tx.lotVerificationEvidence.findFirst({where:{requestId,ownerUserId:r.userId,deletedAt:null}});if(!e)fail("FILE_REQUIRED","Không có hồ sơ hợp lệ.",409);
        await verifiedLotEvidence(storage,e);
        const now=new Date();await tx.lotVerificationEvidence.update({where:{id:e.id},data:{reviewedAt:now}});
        await tx.lotCredentialRequest.update({where:{id:requestId},data:{status:"APPROVED",operatorId:u.id,recordReviewedAt:now}});
      }else if(body.action==="REJECT"){
        if(!["PENDING_EVIDENCE","PENDING_REVIEW","APPROVED"].includes(r.status))fail("INVALID_TRANSITION","Không thể từ chối trạng thái hiện tại.",409);
        await tx.lotCredentialRequest.update({where:{id:requestId},data:{status:"REJECTED",operatorId:u.id,reason:body.reason}});
      }else{
        if(r.status!=="ISSUED"||!r.credentialId)fail("INVALID_TRANSITION","Chỉ thu hồi yêu cầu đã phát hành.",409);
        const now=new Date();await tx.lotCredentialRequest.update({where:{id:requestId},data:{status:"REVOKED",revokedAt:now,reason:body.reason,operatorId:u.id}});
        await tx.lotCredential.updateMany({where:{id:r.credentialId,lotId:r.lotId},data:{status:"REVOKED",revokedAt:now,revocationReason:body.reason}});
        await tx.lotProof.updateMany({where:{credentialId:r.credentialId,lotId:r.lotId},data:{status:"STALE"}});
      }
      await tx.auditLog.create({data:{actorId:u.id,action:"LOT_REQUEST_"+body.action,objectId:requestId}});return tx.lotCredentialRequest.findUnique({where:{id:requestId},select:fields});
    });
  });
}
