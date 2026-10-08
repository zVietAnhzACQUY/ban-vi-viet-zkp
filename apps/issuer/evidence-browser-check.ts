// Read-only diagnostics scoped to the fictional Browser E2E request.
import { db } from "../api/src/db.js";
import { evidenceStorage, openEvidence } from "./evidence-storage.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
if (!/^g2_test/.test(new URL(process.env.DATABASE_URL!).searchParams.get("schema") || "")) throw new Error("Test schema only");
const id = "483cda5f-eed1-4b94-a7fb-e78f7c139523";
try {
  const request = await db.ageCredentialRequest.findUniqueOrThrow({where:{id},select:{status:true,recordReviewedAt:true,operatorId:true,evidence:{select:{storageKey:true,size:true,sha256:true}}}});
  const evidence=request.evidence[0]; if(!evidence) throw new Error("Synthetic evidence absent");
  const storage=evidenceStorage();
  const ciphertext=await readFile(join(storage.directory,evidence.storageKey+".ageenc"));
  const plaintext=await openEvidence(storage,evidence.storageKey);
  const checks={status:request.status,reviewed:!!request.recordReviewedAt,operatorRecorded:!!request.operatorId,envelope:ciphertext.subarray(0,5).equals(Buffer.from("AGEE1")),notPng:ciphertext[0]!==137,ciphertextSize:ciphertext.length===evidence.size+33,authenticatedHash:createHash("sha256").update(plaintext).digest("hex")===evidence.sha256};
  console.log(JSON.stringify(checks));
  if(Object.values(checks).some(value=>value===false)||request.status!=="APPROVED")process.exitCode=1;
} finally {await db.$disconnect();}
