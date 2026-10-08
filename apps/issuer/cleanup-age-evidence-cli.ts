import { db } from "../api/src/db.js";
import { evidenceStorage } from "./evidence-storage.js";
import { cleanupAgeEvidence } from "./cleanup-age-evidence.js";
const flags=process.argv.slice(2);
if(flags.some(flag=>!["--apply","--owner-approved"].includes(flag))) throw new Error("Unknown option");
if(flags.includes("--apply")&&!flags.includes("--owner-approved")) throw new Error("Explicit owner approval required for cleanup apply.");
try { console.log(JSON.stringify(await cleanupAgeEvidence(db,evidenceStorage(),{apply:flags.includes("--apply"),retentionHours:Number(process.env.AGE_EVIDENCE_RETENTION_HOURS||24)}))); }
finally { await db.$disconnect(); }
