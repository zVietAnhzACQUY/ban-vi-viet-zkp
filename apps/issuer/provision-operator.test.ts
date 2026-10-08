import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID,randomBytes} from "node:crypto";
import {db} from "../api/src/db.js";
import {provisionOperator} from "./provision-operator.js";
if(process.env.G2_TEST!=="1"||new URL(process.env.DATABASE_URL!).searchParams.get("schema")!=="g2_test_20261007")throw new Error("Dedicated new test schema required");
try {
  await test("operator provisioning is atomic, audited, idempotent and rejects role conflicts",async()=>{
    const email=randomUUID()+"@fictional.invalid",password=randomBytes(24).toString("base64url");
    const results=await Promise.all([provisionOperator(db,email,password),provisionOperator(db,email,password)]);
    assert.equal(results.filter(r=>r.created).length,1);
    assert.equal(await db.user.count({where:{email}}),1);
    assert.equal(await db.auditLog.count({where:{objectId:results[0].id,action:"ISSUER_OPERATOR_ACCOUNT_CREATED"}}),1);
    const existing=await provisionOperator(db,email,undefined);assert.equal(existing.created,false);
    const merchant=await db.user.create({data:{email:randomUUID()+"@fictional.invalid",name:"Fictional",role:"ADMIN",passwordHash:"test"}});
    await assert.rejects(provisionOperator(db,merchant.email,password),/EXISTING_ROLE_CONFLICT/);
    assert.equal((await db.user.findUniqueOrThrow({where:{id:merchant.id},select:{role:true}})).role,"ADMIN");
    await assert.rejects(provisionOperator(db,"admin@banviviet.demo",password),/EMAIL_NOT_ALLOWED/);
    await provisionOperator(db,email,randomBytes(24).toString("base64url"),true);
    assert.equal(await db.auditLog.count({where:{objectId:existing.id,action:"ISSUER_OPERATOR_PASSWORD_RESET"}}),1);
  });
}finally{await db.$disconnect();}
