import {
  createHash,
  createPrivateKey,
  createPublicKey,
  randomBytes,
  randomUUID,
  sign,
  verify,
  type KeyObject,
  type JsonWebKey,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import {
  AGE_CREDENTIAL_DOMAIN,
  AGE_ISSUER_ID,
  FIELD_MODULUS,
  ageCommitment,
  ageCredentialMessage,
  dayIndex,
  userIdHash,
  type AgeCredentialFile,
  type AgeCredentialMetadata,
} from "../shared/g3.js";
import { ageCredentialFileSchema } from "../shared/age-wallet.js";
import { deliveryKey, sealAgeCredential } from "./delivery-crypto.js";

type IssuerDb = import("../api/generated/client/index.js").PrismaClient;

export async function claimAgeCredentialIssuance(
  db: IssuerDb,
  input: {
    requestId: string;
    userId: string;
    credentialId: string;
    issuedAt: Date;
    expiresAt: Date;
    issuerKeyId: string;
  },
) {
  const claimed = await db.ageCredentialRequest.updateMany({
    where: {
      id: input.requestId,
      userId: input.userId,
      status: "APPROVED",
      issuedAt: null,
      credentialId: null,
      operatorId: { not: null },
      recordSubmittedAt: { not: null },
      recordReviewedAt: { not: null },
      consentAt: { not: null },
      verificationMethod: { not: null },
    },
    data: {
      status: "ISSUING",
      credentialId: input.credentialId,
      issuedAt: input.issuedAt,
      expiresAt: input.expiresAt,
      issuerKeyId: input.issuerKeyId,
      circuitVersion: 1,
    },
  });
  return claimed.count === 1;
}

export async function rollbackAgeCredentialClaim(
  db: IssuerDb,
  requestId: string,
  credentialId: string,
) {
  const rolledBack = await db.ageCredentialRequest.updateMany({
    where: { id: requestId, status: "ISSUING", credentialId },
    data: {
      status: "APPROVED",
      credentialId: null,
      issuedAt: null,
      expiresAt: null,
      issuerKeyId: null,
    },
  });
  if (rolledBack.count !== 1)
    throw new Error("Không thể hoàn nguyên claim phát hành AGE; cần operator xử lý trạng thái ISSUING.");
}

export async function finalizeAgeCredentialIssuance(
  db: IssuerDb,
  requestId: string,
  credentialId: string,
  delivery?: { credential: AgeCredentialFile; encryptionKey: Buffer },
) {
  return db.$transaction(async (tx) => {
    const request = await tx.ageCredentialRequest.findFirst({
      where: { id: requestId, status: "ISSUING", credentialId },
    });
    if (!request?.operatorId)
      throw new Error("Claim phát hành không hợp lệ hoặc thiếu operator.");
    if (delivery) {
      const sealed = sealAgeCredential(delivery.credential, delivery.encryptionKey);
      if (
        delivery.credential.metadata.credentialId !== credentialId ||
        delivery.credential.metadata.userIdHash !== (await userIdHash(request.userId))
      )
        throw new Error("Credential delivery không khớp request phát hành.");
      await tx.ageCredentialDelivery.upsert({
        where: { requestId },
        create: {
          requestId,
          userId: request.userId,
          credentialId,
          ...sealed,
        },
        update: {
          userId: request.userId,
          credentialId,
          ...sealed,
        },
      });
    }
    const updated = await tx.ageCredentialRequest.updateMany({
      where: { id: requestId, status: "ISSUING", credentialId },
      data: { status: "ISSUED" },
    });
    if (updated.count !== 1)
      throw new Error("Request không còn ở trạng thái ISSUING.");
    await tx.auditLog.create({
      data: {
        actorId: request.operatorId,
        action: "AGE_CREDENTIAL_ISSUED_BY_CLI",
        objectId: `${requestId}:${credentialId}`,
      },
    });
  });
}

export async function issueAgeCredential(input: {
  userId: string;
  dateOfBirth: string;
  privateKey: KeyObject;
  publicKeyBase64url: string;
  fingerprint: string;
  issuedAtSeconds: number;
  expiresAtSeconds: number;
}) {
  if (input.issuedAtSeconds >= input.expiresAtSeconds)
    throw new Error("issuedAt phải trước expiresAt.");
  const dob = dayIndex(input.dateOfBirth);
  const issuedDay = dayIndex(
    new Date(input.issuedAtSeconds * 1000).toISOString().slice(0, 10),
  );
  if (dob > issuedDay) throw new Error("Ngày sinh không được ở tương lai.");
  const dobDay = String(dob);
  const randomField = () => {
    for (;;) {
      const value = BigInt("0x" + randomBytes(32).toString("hex"));
      if (value > 0n && value < FIELD_MODULUS) return value.toString();
    }
  };
  const salt = randomField();
  const holderSecret = randomField();
  const metadata: AgeCredentialMetadata = {
    domain: AGE_CREDENTIAL_DOMAIN,
    schemaVersion: 1 as const,
    circuitVersion: 1 as const,
    credentialId: randomUUID(),
    issuerId: AGE_ISSUER_ID,
    commitment: await ageCommitment(dobDay, salt, holderSecret),
    userIdHash: await userIdHash(input.userId),
    issuedAt: String(input.issuedAtSeconds),
    expiresAt: String(input.expiresAtSeconds),
    issuerKeyVersion: 1 as const,
  };
  const signature = sign(
    null,
    ageCredentialMessage(metadata),
    input.privateKey,
  );
  const credential: AgeCredentialFile = {
    type: "AGE",
    privateInputs: { dobDay, salt, holderSecret },
    metadata,
    issuerFingerprint: input.fingerprint,
    signature: signature.toString("base64url"),
  };
  return credential;
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export function validateAgeIssuerMode(
  requestId: string | undefined,
  allowUntracked: boolean,
  nodeEnv = process.env.NODE_ENV,
) {
  if (!requestId && !allowUntracked)
    throw new Error("Pilot mode bắt buộc --request. Fixture demo phải dùng --allow-untracked-demo rõ ràng.");
  if (allowUntracked && nodeEnv === "production")
    throw new Error("--allow-untracked-demo bị cấm trong production.");
}

async function main() {
  const repository = realpathSync(resolve(import.meta.dirname, "../.."));
  const defaultKey = resolve(
    process.env.LOCALAPPDATA || "",
    "BanViViet/issuer/age.pkcs8.pem",
  );
  const keyPath = resolve(argument("--key") || defaultKey);
  const outputPath = resolve(argument("--out") || "");
  const requestId = argument("--request");
  const allowUntracked = process.argv.includes("--allow-untracked-demo");
  validateAgeIssuerMode(requestId, allowUntracked);
  if (!argument("--out"))
    throw new Error("Chỉ định --out tới tệp credential nằm ngoài repository.");
  const outputRelative = relative(repository, outputPath);
  if (!isAbsolute(outputRelative) && !outputRelative.startsWith(".."))
    throw new Error(
      "Credential chứa dữ liệu kín và phải nằm ngoài repository.",
    );
  if (!existsSync(keyPath))
    throw new Error(`Không tìm thấy AGE private key: ${keyPath}`);
  const ownerPublic = JSON.parse(
    readFileSync(resolve(repository, "artifacts/issuer-public.json"), "utf8"),
  ).issuers.find((item: any) => item.type === "AGE");
  const privateKey = createPrivateKey(readFileSync(keyPath));
  const publicKey = createPublicKey(privateKey);
  const publicKeyBase64url = (publicKey.export({ format: "jwk" }) as JsonWebKey)
    .x!;
  const fingerprint = createHash("sha256")
    .update(Buffer.from(publicKeyBase64url, "base64url"))
    .digest("hex");
  if (
    publicKeyBase64url !== ownerPublic.publicKey ||
    fingerprint !== ownerPublic.fingerprint
  )
    throw new Error("Private key không khớp AGE public key đã pin ở G1.");
  const prompt = createInterface({ input: stdin, output: stdout });
  let issuerDb: IssuerDb | null = null;
  try {
    let requestRecord: any = null;
    if (requestId) {
      const module = await import("../api/src/db.js");
      issuerDb = module.db;
      requestRecord = await issuerDb.ageCredentialRequest.findUnique({
        where: { id: requestId },
      });
      if (!requestRecord)
        throw new Error("Yêu cầu cấp AGE không tồn tại.");
      if (requestRecord.status === "ISSUING") {
        if (!existsSync(outputPath))
          throw new Error("Request đang ISSUING nhưng không có tệp để recovery; operator cần xử lý thủ công.");
        const saved = ageCredentialFileSchema.parse(
          JSON.parse(readFileSync(outputPath, "utf8")),
        );
        if (
          saved.metadata.credentialId !== requestRecord.credentialId ||
          saved.metadata.userIdHash !== (await userIdHash(requestRecord.userId)) ||
          saved.metadata.issuerId !== AGE_ISSUER_ID ||
          saved.metadata.issuerKeyVersion !== 1 ||
          saved.issuerFingerprint !== fingerprint ||
          Number(saved.metadata.issuedAt) !==
            Math.floor(requestRecord.issuedAt.getTime() / 1000) ||
          Number(saved.metadata.expiresAt) !==
            Math.floor(requestRecord.expiresAt.getTime() / 1000) ||
          !verify(
            null,
            ageCredentialMessage(saved.metadata),
            publicKey,
            Buffer.from(saved.signature, "base64url"),
          )
        )
          throw new Error("Tệp recovery không khớp claim ISSUING.");
        await finalizeAgeCredentialIssuance(
          issuerDb,
          requestRecord.id,
          saved.metadata.credentialId,
          { credential: saved, encryptionKey: deliveryKey() },
        );
        console.log("Đã hoàn tất recovery cho request ISSUING.");
        return;
      }
      if (requestRecord.status !== "APPROVED")
        throw new Error("Yêu cầu cấp AGE không tồn tại hoặc chưa được operator duyệt.");
      if (!requestRecord.operatorId)
        throw new Error("Yêu cầu APPROVED thiếu operator.");
    }
    if (existsSync(outputPath))
      throw new Error("Từ chối ghi đè credential đã có.");
    const userId = requestRecord?.userId ?? (await prompt.question("UUID tài khoản demo: ")).trim();
    const dateOfBirth = (
      await prompt.question("Ngày sinh hư cấu YYYY-MM-DD: ")
    ).trim();
    const issuedAtSeconds = Math.floor(Date.now() / 1000);
    const credential = await issueAgeCredential({
      userId,
      dateOfBirth,
      privateKey,
      publicKeyBase64url,
      fingerprint,
      issuedAtSeconds,
      expiresAtSeconds: issuedAtSeconds + 30 * 86400,
    });
    if (requestRecord) {
      const claimed = await claimAgeCredentialIssuance(issuerDb!, {
        requestId: requestRecord.id,
        userId,
        credentialId: credential.metadata.credentialId,
        issuedAt: new Date(issuedAtSeconds * 1000),
        expiresAt: new Date(Number(credential.metadata.expiresAt) * 1000),
        issuerKeyId: `${AGE_ISSUER_ID}:v1`,
      });
      if (!claimed)
        throw new Error("Request đã được tiến trình khác claim hoặc không còn APPROVED.");
      try {
        mkdirSync(dirname(outputPath), { recursive: true });
        writeFileSync(outputPath, JSON.stringify(credential, null, 2) + "\n", {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        await rollbackAgeCredentialClaim(
          issuerDb!,
          requestRecord.id,
          credential.metadata.credentialId,
        );
        throw error;
      }
      await finalizeAgeCredentialIssuance(
        issuerDb!,
        requestRecord.id,
        credential.metadata.credentialId,
        { credential, encryptionKey: deliveryKey() },
      );
    } else {
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(outputPath, JSON.stringify(credential, null, 2) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
    }
    console.log(`Đã ghi credential: ${outputPath}`);
    console.log(`Credential ID: ${credential.metadata.credentialId}`);
    console.log(
      `Hết hạn UTC: ${new Date(Number(credential.metadata.expiresAt) * 1000).toISOString()}`,
    );
    console.log(
      "Không gửi credential hoặc private key vào chat; chỉ nạp credential vào browser demo.",
    );
  } finally {
    prompt.close();
    if (issuerDb) await issuerDb.$disconnect();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
)
  await main();
