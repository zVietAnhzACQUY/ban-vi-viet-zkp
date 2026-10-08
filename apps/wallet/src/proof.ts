import { groth16 } from "snarkjs";
import {
  AGE_PUBLIC_SIGNALS,
  AGE_SIGNAL_SCHEMA_SHA256,
  AGE_WASM_SHA256,
  AGE_ZKEY_SHA256,
  G1_MANIFEST_SHA256,
  ageCommitment,
  ageNullifier,
} from "../../shared/g3";
import type {
  AgeCredentialFile,
  AgeProofBundle,
  AgeProofRequest,
} from "../../shared/age-wallet";

type LoadedArtifacts = {
  wasm: Uint8Array;
  zkey: Uint8Array;
  cache: "cold" | "warm";
  wasmLoadMs: number;
  zkeyLoadMs: number;
};
export type ProofProgress = {
  stage: "wasm" | "zkey" | "proof";
  message: string;
};

let artifactCache: Promise<LoadedArtifacts> | undefined;
const ARTIFACT_CACHE = "bvv-age-artifacts-v1";

async function sha256Hex(bytes: Uint8Array) {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    ),
  );
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyArtifactHash(
  bytes: Uint8Array,
  expectedHash: string,
) {
  if ((await sha256Hex(bytes)) !== expectedHash)
    throw new Error("Tệp mật mã không khớp phiên bản đã được hệ thống tin cậy.");
  return bytes;
}

async function fetchArtifact(url: string, expectedHash: string) {
  const startedAt = performance.now();
  const store = await caches.open(ARTIFACT_CACHE);
  const cached = await store.match(url);
  if (cached) {
    const bytes = new Uint8Array(await cached.arrayBuffer());
    try {
      await verifyArtifactHash(bytes, expectedHash);
      return {
        bytes,
        cacheHit: true,
        loadMs: performance.now() - startedAt,
      };
    } catch {
      // A corrupt cache entry must never reach the prover.
    }
    await store.delete(url);
  }
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("Không tải được tệp cần cho quá trình xác minh.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  await verifyArtifactHash(bytes, expectedHash);
  await store.put(
    url,
    new Response(bytes, {
      headers: { "Content-Type": "application/octet-stream" },
    }),
  );
  return {
    bytes,
    cacheHit: false,
    loadMs: performance.now() - startedAt,
  };
}

async function loadArtifacts(
  request: AgeProofRequest,
  onProgress?: (progress: ProofProgress) => void,
) {
  if (!artifactCache) {
    artifactCache = (async () => {
      onProgress?.({
        stage: "wasm",
        message: "Đang chuẩn bị bộ kiểm tra trên thiết bị…",
      });
      const wasm = await fetchArtifact(
        request.artifact.wasmUrl,
        AGE_WASM_SHA256,
      );
      onProgress?.({
        stage: "zkey",
        message: "Đang tải khóa tạo bằng chứng đã được kiểm tra…",
      });
      const zkey = await fetchArtifact(
        request.artifact.zkeyUrl,
        AGE_ZKEY_SHA256,
      );
      return {
        wasm: wasm.bytes,
        zkey: zkey.bytes,
        cache: wasm.cacheHit && zkey.cacheHit ? "warm" : "cold",
        wasmLoadMs: wasm.loadMs,
        zkeyLoadMs: zkey.loadMs,
      };
    })();
  } else {
    const loaded = await artifactCache;
    return {
      ...loaded,
      cache: "warm" as const,
      wasmLoadMs: 0,
      zkeyLoadMs: 0,
    };
  }
  try {
    return await artifactCache;
  } catch (error) {
    artifactCache = undefined;
    throw error;
  }
}

export async function createAgeProofInWallet(
  credential: AgeCredentialFile,
  request: AgeProofRequest,
  onProgress?: (progress: ProofProgress) => void,
) {
  if (
    request.artifact.circuitVersion !== 1 ||
    request.artifact.manifestSha256 !== G1_MANIFEST_SHA256 ||
    request.artifact.signalSchemaSha256 !== AGE_SIGNAL_SCHEMA_SHA256 ||
    JSON.stringify(request.artifact.publicSignals) !==
      JSON.stringify(AGE_PUBLIC_SIGNALS)
  )
    throw new Error("Cấu hình xác minh không khớp phiên bản được tin cậy.");
  if (credential.metadata.userIdHash !== request.subjectHash)
    throw new Error("Thông tin xác minh không thuộc tài khoản đang yêu cầu.");
  const commitment = await ageCommitment(
    credential.privateInputs.dobDay,
    credential.privateInputs.salt,
    credential.privateInputs.holderSecret,
  );
  if (commitment !== credential.metadata.commitment)
    throw new Error("Thông tin đã lưu không khớp nội dung được ký.");
  const nullifier = await ageNullifier(
    credential.privateInputs.holderSecret,
    request.requestHash,
  );
  const totalStarted = performance.now();
  const loaded = await loadArtifacts(request, onProgress);
  onProgress?.({
    stage: "proof",
    message: "Đang tạo bằng chứng riêng tư trên thiết bị…",
  });
  const proofStarted = performance.now();
  const result = await groth16.fullProve(
    {
      dobDay: credential.privateInputs.dobDay,
      salt: credential.privateInputs.salt,
      holderSecret: credential.privateInputs.holderSecret,
      commitment,
      cutoffDay: request.cutoffDay,
      requestHash: request.requestHash,
      nullifier,
    },
    loaded.wasm,
    loaded.zkey,
  );
  const proofMs = performance.now() - proofStarted;
  const expected = [
    commitment,
    request.cutoffDay,
    request.requestHash,
    nullifier,
  ];
  if (JSON.stringify(result.publicSignals) !== JSON.stringify(expected))
    throw new Error("Kết quả xác minh trên thiết bị không đúng định dạng.");
  const proofBundle: AgeProofBundle = {
    challengeId: request.challengeId,
    credential: {
      metadata: credential.metadata,
      issuerFingerprint: credential.issuerFingerprint,
      signature: credential.signature,
    },
    proof: result.proof as AgeProofBundle["proof"],
    publicSignals: result.publicSignals as AgeProofBundle["publicSignals"],
  };
  return {
    proofBundle,
    timings: {
      cache: loaded.cache,
      wasmLoadMs: loaded.wasmLoadMs,
      zkeyLoadMs: loaded.zkeyLoadMs,
      proofMs,
      walletTotalMs: performance.now() - totalStarted,
    },
  };
}

export function clearArtifactCacheForTest() {
  artifactCache = undefined;
}
