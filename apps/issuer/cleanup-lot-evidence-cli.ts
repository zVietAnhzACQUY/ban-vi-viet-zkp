import { db } from "../api/src/db.js";
import { evidenceStorage } from "./evidence-storage.js";
import { cleanupLotEvidence } from "./cleanup-lot-evidence.js";
const apply=process.argv.includes("--apply");
if(apply&&!process.argv.includes("--owner-approved"))throw new Error("Explicit owner approval required.");
try{console.log(await cleanupLotEvidence(db,evidenceStorage(),{apply,retentionHours:Number(process.env.LOT_EVIDENCE_RETENTION_HOURS||24)}));}catch{console.error("LOT evidence cleanup failed; no sensitive details printed.");process.exitCode=1;}finally{await db.$disconnect();}
