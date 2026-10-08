import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  randomUUID,
  sign,
  verify,
  type JsonWebKey,
  type KeyObject,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LOT_ALLOWED_CODE,
  LOT_CREDENTIAL_DOMAIN,
  LOT_ISSUER_ID,
  LOT_ISSUER_FINGERPRINT,
  lotCodeHash,
  lotCommitment,
  lotCredentialMessage,
  productIdHash,
  randomLotField,
  supplierIdHash,
  type LotCredentialFile,
  type LotCredentialMetadata,
} from "../shared/g4.js";
import { claimLotIssuance, finalizeLotIssuance, releaseLotIssuance } from "./lot-issuance.js";
import { parseLotCredential } from "../prover/prove-lot.js";

export async function issueLotCredential(input: {
  productId: string;
  lotCode: string;
  supplierCode: string;
  originCode: string;
  publicAllowedCode?: string;
  privateKey: KeyObject;
  fingerprint: string;
  issuedAtSeconds: number;
  expiresAtSeconds: number;
  credentialId?: string;
}) {
  if (input.issuedAtSeconds >= input.expiresAtSeconds)
    throw new Error("issuedAt phải trước expiresAt.");
  if (!["1", "2"].includes(input.originCode))
    throw new Error("Mã vùng demo chỉ nhận 1 hoặc 2.");
  const allowedCode = input.publicAllowedCode ?? LOT_ALLOWED_CODE;
  const supplierHash = await supplierIdHash(input.supplierCode);
  const boundLotHash = await lotCodeHash(input.productId, input.lotCode);
  const salt = randomLotField((size) => randomBytes(size));
  const metadata: LotCredentialMetadata = {
    domain: LOT_CREDENTIAL_DOMAIN,
    schemaVersion: 1,
    circuitVersion: 1,
    credentialId: input.credentialId ?? randomUUID(),
    issuerId: LOT_ISSUER_ID,
    commitment: await lotCommitment(
      input.originCode,
      supplierHash,
      salt,
      boundLotHash,
    ),
    productIdHash: await productIdHash(input.productId),
    lotCodeHash: boundLotHash,
    policyVersion: 1,
    publicAllowedCode: allowedCode,
    issuedAt: String(input.issuedAtSeconds),
    expiresAt: String(input.expiresAtSeconds),
    issuerKeyVersion: 1,
  };
  const credential: LotCredentialFile = {
    type: "LOT",
    productId: input.productId,
    lotCode: input.lotCode,
    privateInputs: {
      originCode: input.originCode,
      supplierIdHash: supplierHash,
      salt,
      privateLotCodeHash: boundLotHash,
    },
    metadata,
    issuerFingerprint: input.fingerprint,
    signature: sign(
      null,
      lotCredentialMessage(metadata),
      input.privateKey,
    ).toString("base64url"),
  };
  return credential;
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const repository = realpathSync(resolve(import.meta.dirname, "../.."));
  const keyPath = resolve(
    argument("--key") ||
      resolve(process.env.LOCALAPPDATA || "", "BanViViet/issuer/lot.pkcs8.pem"),
  );
  const outputArg = argument("--out");
  if (!outputArg)
    throw new Error("Chỉ định --out tới tệp credential nằm ngoài repository.");
  const outputPath = resolve(outputArg);
  const outputRelative = relative(repository, outputPath);
  if (!isAbsolute(outputRelative) && !outputRelative.startsWith(".."))
    throw new Error(
      "Credential LOT chứa dữ liệu kín và phải nằm ngoài repository.",
    );
  if (existsSync(outputPath) && !process.argv.includes("--finalize-existing"))
    throw new Error("Từ chối ghi đè credential đã có.");

  const requestId = argument("--request");
  const supplierCode = argument("--supplier-code");
  if (!requestId || (!supplierCode && !process.argv.includes("--finalize-existing")))
    throw new Error("Cần --request và --supplier-code (chỉ dùng dữ liệu hư cấu).");
  const originCode = argument("--origin-code") || LOT_ALLOWED_CODE;
  const [{ db }] = await Promise.all([import("../api/src/db.js")]);
  try {
    const request = await db.lotCredentialRequest.findUnique({where:{id:requestId}});
    if(!request)throw new Error("Không tìm thấy LOT request.");
    const lot = await db.lot.findUnique({ where: { id: request.lotId } });
    if (!lot || lot.status === "ARCHIVED" || lot.productId!==request.productId || lot.lotCode!==request.lotCode)
      throw new Error("LOT request không còn khớp lô đang vận hành.");
    const ownerPublic = JSON.parse(
      readFileSync(resolve(repository, "artifacts/issuer-public.json"), "utf8"),
    ).issuers.find((item: any) => item.type === "LOT");
    if(process.argv.includes("--finalize-existing")) {
      if(!["ISSUING","ISSUED"].includes(request.status)||!request.credentialId||!existsSync(outputPath))throw new Error("Không có claim/tệp để phục hồi.");
      const credential=parseLotCredential(readFileSync(outputPath,"utf8"));
      const p=credential.privateInputs;
      if(credential.metadata.commitment!==await lotCommitment(p.originCode,p.supplierIdHash,p.salt,p.privateLotCodeHash)||p.privateLotCodeHash!==await lotCodeHash(request.productId,request.lotCode))throw new Error("Tệp phục hồi không khớp commitment/binding.");
      const m=credential.metadata,publicKey=createPublicKey({key:{kty:"OKP",crv:"Ed25519",x:ownerPublic.publicKey},format:"jwk"});
      if(m.credentialId!==request.credentialId||credential.productId!==request.productId||credential.lotCode!==request.lotCode||m.productIdHash!==await productIdHash(request.productId)||m.lotCodeHash!==await lotCodeHash(request.productId,request.lotCode)||m.publicAllowedCode!==LOT_ALLOWED_CODE||credential.issuerFingerprint!==LOT_ISSUER_FINGERPRINT||ownerPublic.fingerprint!==LOT_ISSUER_FINGERPRINT||request.issuerKeyId!==`${m.issuerId}:v${m.issuerKeyVersion}`||request.issuedAt?.getTime()!==Number(m.issuedAt)*1000||request.expiresAt?.getTime()!==Number(m.expiresAt)*1000||!verify(null,lotCredentialMessage(m),publicKey,Buffer.from(credential.signature,"base64url")))throw new Error("Tệp phục hồi không khớp claim/chữ ký đã pin.");
      await finalizeLotIssuance(db,requestId,m.credentialId);console.log("LOT finalize recovery PASS.");return;
    }
    // Check approval before reading any private key; claim remains exclusive below.
    if(request.status!=="APPROVED"||!request.recordReviewedAt||!request.operatorId)throw new Error("LOT request chưa APPROVED.");
    if (!existsSync(keyPath)) throw new Error("Không tìm thấy LOT private key ngoài repository.");
    const keyRelative=relative(repository,realpathSync(keyPath));
    if(!isAbsolute(keyRelative)&&!keyRelative.startsWith(".."))throw new Error("LOT private key phải ở ngoài repository.");
    const privateKey = createPrivateKey(readFileSync(keyPath));
    const publicKey = createPublicKey(privateKey);
    const publicKeyBase64url = (
      publicKey.export({ format: "jwk" }) as JsonWebKey
    ).x!;
    const fingerprint = createHash("sha256")
      .update(Buffer.from(publicKeyBase64url, "base64url"))
      .digest("hex");
    if (
      publicKeyBase64url !== ownerPublic.publicKey ||
      fingerprint !== ownerPublic.fingerprint ||
      fingerprint !== LOT_ISSUER_FINGERPRINT
    )
      throw new Error("Private key không khớp LOT public key đã pin ở G1.");
    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const credential = await issueLotCredential({
      productId: lot.productId,
      lotCode: lot.lotCode,
      supplierCode: supplierCode!,
      originCode,
      privateKey,
      fingerprint,
      issuedAtSeconds,
      expiresAtSeconds: issuedAtSeconds + 30 * 86400,
    });
    await claimLotIssuance(db,{requestId,credentialId:credential.metadata.credentialId,issuedAt:new Date(issuedAtSeconds*1000),expiresAt:new Date(Number(credential.metadata.expiresAt)*1000)});
    try {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, JSON.stringify(credential, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    } catch(error) {
      // A partial/existing file is never automatically overwritten or signed again.
      if(!existsSync(outputPath))await releaseLotIssuance(db,requestId,credential.metadata.credentialId);
      throw new Error("Không ghi được credential; kiểm tra claim/tệp trước khi phục hồi.");
    }
    await finalizeLotIssuance(db,requestId,credential.metadata.credentialId);
    console.log(`Đã ghi credential LOT: ${outputPath}`);
    console.log(`Credential ID: ${credential.metadata.credentialId}`);
    console.log(
      `Hết hạn UTC: ${new Date(Number(credential.metadata.expiresAt) * 1000).toISOString()}`,
    );
    console.log(
      "Không gửi private key, credential, mã nhà cung cấp, salt hoặc witness vào chat.",
    );
  } finally {
    await db.$disconnect();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
)
  await main().catch(()=>{console.error("LOT issuance failed. Check request approval/binding, external key/output and recovery mode; no sensitive details printed.");process.exitCode=1;});
