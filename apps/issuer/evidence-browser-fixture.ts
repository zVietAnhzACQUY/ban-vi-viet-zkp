import { db } from "../api/src/db.js";
import argon2 from "argon2";
if(!/^g2_test/.test(new URL(process.env.DATABASE_URL!).searchParams.get("schema")||""))throw new Error("Test schema only");
const passwordHash=await argon2.hash("Fictional@2026",{type:argon2.argon2id});
for(const [email,role] of [["customer@evidence.invalid","CUSTOMER"],["operator@evidence.invalid","ADMIN"]] as const) await db.user.upsert({where:{email},create:{email,role,name:"Fictional E2E",passwordHash},update:{}});
await db.$disconnect();console.log("Synthetic browser accounts ready in test schema.");
