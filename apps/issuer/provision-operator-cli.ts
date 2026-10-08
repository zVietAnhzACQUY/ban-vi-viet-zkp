import { db } from "../api/src/db.js";
import { provisionOperator } from "./provision-operator.js";

async function hiddenPassword(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdin.setRawMode) throw new Error("TTY_REQUIRED");
  process.stdout.write(label);
  process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding("utf8");
  return new Promise((resolve,reject)=>{
    let value="";
    const finish=(error?:Error)=>{process.stdin.off("data",read);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write("\n");error?reject(error):resolve(value);};
    const read=(chunk:string)=>{for(const char of chunk){if(char==="\u0003"){finish(new Error("CANCELLED"));return;}if(char==="\r"||char==="\n"){finish();return;}if(char==="\u007f"||char==="\b")value=value.slice(0,-1);else if(char>=" ")value+=char;}};
    process.stdin.on("data",read);
  });
}

try {
  const flags=process.argv.slice(2);
  if(flags.some(flag=>flag!=="--reset-password"))throw new Error("FLAGS_NOT_ALLOWED");
  const url=new URL(process.env.DATABASE_URL!);
  if(url.hostname!=="127.0.0.1"||url.port!=="5434"||url.pathname!=="/banviviet"||![null,"public"].includes(url.searchParams.get("schema")))throw new Error("PUBLIC_LOCAL_REQUIRED");
  const schema=await db.$queryRaw<{schema:string}[]>`SELECT current_schema() AS schema`;
  if(schema[0]?.schema!=="public")throw new Error("PUBLIC_LOCAL_REQUIRED");
  const migration=await db.$queryRaw<{ready:boolean}[]>`SELECT EXISTS(SELECT 1 FROM "_prisma_migrations" WHERE migration_name='202610070002_issuer_operator_role' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) AS ready`;
  if(!migration[0]?.ready)throw new Error("ROLE_MIGRATION_REQUIRED");
  const email=(process.env.ISSUER_OPERATOR_EMAIL||"operator@evidence.invalid").trim().toLowerCase();
  const existing=await db.user.findUnique({where:{email},select:{id:true,role:true}});
  if(existing && existing.role!=="ISSUER_OPERATOR")throw new Error("EXISTING_ROLE_CONFLICT");
  const reset=flags.includes("--reset-password");
  let password:string|undefined;
  if(!existing||reset){
    password=process.env.ISSUER_OPERATOR_PASSWORD;delete process.env.ISSUER_OPERATOR_PASSWORD;
    if(!password){password=await hiddenPassword("Mật khẩu mới (ẩn, 12–128 ký tự): ");const confirmation=await hiddenPassword("Nhập lại mật khẩu (ẩn): ");if(password!==confirmation)throw new Error("PASSWORD_CONFIRMATION");}
  }
  const result=await provisionOperator(db,email,password,reset);password=undefined;
  console.log(JSON.stringify({email,userId:result.id,role:"ISSUER_OPERATOR",created:result.created,passwordReset:result.reset}));
}catch(error){
  const allowed=new Set(["TTY_REQUIRED","CANCELLED","FLAGS_NOT_ALLOWED","PUBLIC_LOCAL_REQUIRED","ROLE_MIGRATION_REQUIRED","EXISTING_ROLE_CONFLICT","PASSWORD_CONFIRMATION","PASSWORD_LENGTH","EMAIL_NOT_ALLOWED"]);
  const code=error instanceof Error && allowed.has(error.message)?error.message:"OPERATOR_OPERATION_FAILED";
  console.error(code);process.exitCode=1;
}finally{await db.$disconnect();}
