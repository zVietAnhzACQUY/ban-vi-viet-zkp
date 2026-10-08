import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { issueAgeCredential } from "../../issuer/issue-age";
import {
  AGE_ISSUER_ID,
  AGE_PUBLIC_SIGNALS,
  AGE_SIGNAL_SCHEMA_SHA256,
  G1_MANIFEST_SHA256,
} from "../../shared/g3";
import {
  AGE_REQUESTER_NAME,
  AGE_REQUEST_PURPOSE,
  AGE_WALLET_PROTOCOL_VERSION,
  AGE_WALLET_READY_TYPE,
  AGE_WALLET_REQUEST_TYPE,
  AGE_WALLET_RESPONSE_TYPE,
  ageProofResponseSchema,
  type AgeProofRequest,
} from "../../shared/age-wallet";
import {
  parseAgeCredential,
  saveValidatedAgeCredential,
  validateAgeCredential,
} from "./credential";
import { validateIncomingProofRequest } from "./protocol";
import { verifyArtifactHash } from "./proof";
import { decryptCredential, encryptCredential } from "./storage";
import {
  shouldLockWalletOnVisibility,
  WALLET_AUTO_LOCK_MS,
} from "./lock-policy";
import {
  WalletRequestGuard,
  waitForWalletProof,
  type WalletTransportRuntime,
} from "../../web/src/wallet";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyBase64url = (
  publicKey.export({ format: "jwk" }) as import("node:crypto").JsonWebKey
).x!;
const fingerprint = createHash("sha256")
  .update(Buffer.from(publicKeyBase64url, "base64url"))
  .digest("hex");
const trust = {
  issuerId: AGE_ISSUER_ID,
  publicKey: publicKeyBase64url,
  fingerprint,
};

function proofRequest(
  overrides: Partial<AgeProofRequest> = {},
): AgeProofRequest {
  const now = Date.now();
  return {
    type: AGE_WALLET_REQUEST_TYPE,
    protocolVersion: AGE_WALLET_PROTOCOL_VERSION,
    requestId: randomUUID(),
    challengeId: randomUUID(),
    requestHash: "123",
    cutoffDay: "40000",
    minimumAge: 18,
    subjectHash: "456",
    requesterOrigin: "http://127.0.0.1:5173",
    returnOrigin: "http://127.0.0.1:5173",
    requesterName: AGE_REQUESTER_NAME,
    purpose: AGE_REQUEST_PURPOSE,
    issuedAt: new Date(now - 1_000).toISOString(),
    expiresAt: new Date(now + 299_000).toISOString(),
    artifact: {
      circuitVersion: 1,
      manifestSha256: G1_MANIFEST_SHA256,
      signalSchemaSha256: AGE_SIGNAL_SCHEMA_SHA256,
      publicSignals: [...AGE_PUBLIC_SIGNALS],
      wasmUrl: "http://127.0.0.1:3001/api/zkp/age/wasm",
      zkeyUrl: "http://127.0.0.1:3001/api/zkp/age/zkey",
    },
    ...overrides,
  };
}

function successResponse(request: AgeProofRequest) {
  return {
    type: AGE_WALLET_RESPONSE_TYPE,
    protocolVersion: AGE_WALLET_PROTOCOL_VERSION,
    status: "SUCCESS" as const,
    requestId: request.requestId,
    challengeId: request.challengeId,
    proofBundle: {
      challengeId: request.challengeId,
      credential: {
        metadata: {
          domain: "BVV-AGE-CREDENTIAL" as const,
          schemaVersion: 1 as const,
          circuitVersion: 1 as const,
          credentialId: randomUUID(),
          issuerId: AGE_ISSUER_ID,
          commitment: "1",
          userIdHash: "2",
          issuedAt: "1",
          expiresAt: "2",
          issuerKeyVersion: 1 as const,
        },
        issuerFingerprint: "a".repeat(64),
        signature: "A".repeat(86),
      },
      proof: {
        pi_a: ["1", "1", "1"] as [string, string, string],
        pi_b: [
          ["1", "1"],
          ["1", "1"],
          ["1", "1"],
        ] as [[string, string], [string, string], [string, string]],
        pi_c: ["1", "1", "1"] as [string, string, string],
        protocol: "groth16" as const,
        curve: "bn128" as const,
      },
      publicSignals: ["1", "2", "3", "4"] as [
        string,
        string,
        string,
        string,
      ],
    },
    timings: {
      cache: "cold" as const,
      wasmLoadMs: 1,
      zkeyLoadMs: 1,
      proofMs: 1,
      walletTotalMs: 3,
      consentedAtEpochMs: Date.now(),
    },
  };
}

function transportHarness(now: number) {
  let listener: ((event: MessageEvent) => void) | undefined;
  let nextId = 1;
  const intervals = new Map<number, () => void>();
  const timeouts = new Map<number, () => void>();
  let removedListeners = 0;
  const runtime: WalletTransportRuntime = {
    now: () => now,
    addMessageListener: (value) => void (listener = value),
    removeMessageListener: (value) => {
      if (listener === value) {
        listener = undefined;
        removedListeners += 1;
      }
    },
    setInterval: (callback) => {
      const id = nextId++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval: (id) => void intervals.delete(id),
    setTimeout: (callback) => {
      const id = nextId++;
      timeouts.set(id, callback);
      return id;
    },
    clearTimeout: (id) => void timeouts.delete(id),
    navigate: () => undefined,
  };
  return {
    runtime,
    emit(data: unknown, popup: Window, origin = "http://127.0.0.1:5174") {
      listener?.({ data, origin, source: popup } as MessageEvent);
    },
    fireClosedTimer() {
      [...intervals.values()][0]?.();
    },
    fireTimeout() {
      [...timeouts.values()][0]?.();
    },
    assertClean() {
      assert.equal(listener, undefined);
      assert.equal(intervals.size, 0);
      assert.equal(timeouts.size, 0);
      assert.equal(removedListeners, 1);
    },
  };
}

await test("Wallet credential validation and local save", async (t) => {
  const now = new Date();
  const issuedAtSeconds = Math.floor(now.getTime() / 1000) - 10;
  const valid = await issueAgeCredential({
    userId: randomUUID(),
    dateOfBirth: "2000-01-01",
    privateKey,
    publicKeyBase64url,
    fingerprint,
    issuedAtSeconds,
    expiresAtSeconds: issuedAtSeconds + 3600,
  });

  await t.test("valid credential is verified before it is saved", async () => {
    let saved: unknown;
    const parsed = parseAgeCredential(JSON.stringify(valid));
    await saveValidatedAgeCredential(
      { save: async (credential) => void (saved = credential) },
      parsed,
      { ...trust, now },
    );
    assert.deepEqual(saved, valid);
  });

  await t.test("wrong schema and tampered signature are rejected", async () => {
    assert.throws(() => parseAgeCredential(JSON.stringify({ type: "AGE" })));
    const tampered = structuredClone(valid);
    tampered.signature =
      (tampered.signature[0] === "A" ? "B" : "A") + tampered.signature.slice(1);
    await assert.rejects(() =>
      validateAgeCredential(tampered, { ...trust, now }),
    );
  });

  await t.test("expired credential is rejected", async () => {
    const expired = await issueAgeCredential({
      userId: randomUUID(),
      dateOfBirth: "2000-01-01",
      privateKey,
      publicKeyBase64url,
      fingerprint,
      issuedAtSeconds: issuedAtSeconds - 3600,
      expiresAtSeconds: issuedAtSeconds - 1,
    });
    await assert.rejects(() =>
      validateAgeCredential(expired, { ...trust, now }),
    );
  });
});

await test("Wallet encrypts credential with PIN and rejects tampering", async (t) => {
  const issuedAtSeconds = Math.floor(Date.now() / 1000) - 10;
  const credential = await issueAgeCredential({
    userId: randomUUID(),
    dateOfBirth: "2000-01-01",
    privateKey,
    publicKeyBase64url,
    fingerprint,
    issuedAtSeconds,
    expiresAtSeconds: issuedAtSeconds + 3600,
  });
  const envelope = await encryptCredential(credential, "12345678");
  assert.equal(JSON.stringify(envelope).includes("privateInputs"), false);
  assert.deepEqual(await decryptCredential(envelope, "12345678"), credential);
  assert.deepEqual(
    await decryptCredential(structuredClone(envelope), "12345678"),
    credential,
  );
  await assert.rejects(() => encryptCredential(credential, "1234567"), /8–64/);
  await t.test("wrong PIN is rejected", async () => {
    await assert.rejects(() => decryptCredential(envelope, "87654321"), /PIN không đúng/);
  });
  await t.test("tampered ciphertext is rejected", async () => {
    const tampered = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -2) + "AA" };
    await assert.rejects(() => decryptCredential(tampered, "12345678"), /đã bị thay đổi/);
  });
});

test("Wallet locks on hidden visibility and has a five-minute inactivity policy", () => {
  assert.equal(shouldLockWalletOnVisibility("hidden"), true);
  assert.equal(shouldLockWalletOnVisibility("visible"), false);
  assert.equal(WALLET_AUTO_LOCK_MS, 300_000);
});

await test("Wallet request protocol enforces origin, source, expiry and replay", () => {
  const opener = {} as Window;
  const request = proofRequest();
  const base = {
    data: request,
    origin: request.requesterOrigin,
    source: opener,
    opener,
    allowedOrigins: new Set([request.requesterOrigin]),
    artifactOrigin: "http://127.0.0.1:3001",
    processed: new Set<string>(),
  };
  assert.equal(validateIncomingProofRequest(base).requestId, request.requestId);
  assert.throws(() =>
    validateIncomingProofRequest({ ...base, origin: "https://evil.invalid" }),
  );
  assert.throws(() =>
    validateIncomingProofRequest({ ...base, source: {} as Window }),
  );
  assert.throws(() =>
    validateIncomingProofRequest({
      ...base,
      data: proofRequest({
        requestId: request.requestId,
        challengeId: request.challengeId,
        artifact: {
          ...request.artifact,
          wasmUrl: "https://evil.invalid/age.wasm",
        },
      }),
    }),
  );
  const wrongTtl = proofRequest();
  wrongTtl.expiresAt = new Date(
    new Date(wrongTtl.expiresAt).getTime() + 1,
  ).toISOString();
  assert.throws(() =>
    validateIncomingProofRequest({ ...base, data: wrongTtl }),
  );
  assert.throws(() =>
    validateIncomingProofRequest({
      ...base,
      now: new Date(request.expiresAt),
    }),
  );
  assert.throws(() =>
    validateIncomingProofRequest({
      ...base,
      processed: new Set([request.requestId]),
    }),
  );
});

await test("Website message guard rejects spoofing and exits cleanly", async (t) => {
  const popup = {} as Window;
  const request = proofRequest();
  const response = {
    type: AGE_WALLET_RESPONSE_TYPE,
    protocolVersion: AGE_WALLET_PROTOCOL_VERSION,
    status: "REJECTED" as const,
    requestId: request.requestId,
    challengeId: request.challengeId,
    code: "USER_REJECTED" as const,
    message: "Khách hàng từ chối.",
  };
  await t.test("origin and event.source must match", () => {
    assert.throws(() =>
      new WalletRequestGuard(request, popup, "http://127.0.0.1:5174").accept({
        data: response,
        origin: "https://evil.invalid",
        source: popup,
      }),
    );
    assert.throws(() =>
      new WalletRequestGuard(request, popup, "http://127.0.0.1:5174").accept({
        data: response,
        origin: "http://127.0.0.1:5174",
        source: {} as Window,
      }),
    );
  });
  await t.test("request and challenge IDs must match", () => {
    for (const changed of [
      { ...response, requestId: randomUUID() },
      { ...response, challengeId: randomUUID() },
    ])
      assert.throws(() =>
        new WalletRequestGuard(request, popup, "http://127.0.0.1:5174").accept({
          data: changed,
          origin: "http://127.0.0.1:5174",
          source: popup,
        }),
      );
  });
  await t.test(
    "rejection, popup close and timeout end the pending state",
    () => {
      const rejected = new WalletRequestGuard(
        request,
        popup,
        "http://127.0.0.1:5174",
      ).accept({
        data: response,
        origin: "http://127.0.0.1:5174",
        source: popup,
      });
      assert.equal(rejected.kind, "RESPONSE");
      assert.match(
        new WalletRequestGuard(request, popup, "http://127.0.0.1:5174").abort(
          "closed",
        ).message,
        /đóng Ví/,
      );
      assert.match(
        new WalletRequestGuard(request, popup, "http://127.0.0.1:5174").abort(
          "timeout",
        ).message,
        /hết thời gian/,
      );
    },
  );
});

await test("Website transport always removes its listener and timers", async (t) => {
  await t.test("successful proof response", async () => {
    const request = proofRequest();
    const popup = {
      closed: false,
      postMessage() {},
    } as unknown as Window;
    const harness = transportHarness(Date.now());
    const pending = waitForWalletProof(
      request,
      popup,
      "http://127.0.0.1:5174",
      harness.runtime,
    );
    harness.emit(
      {
        type: AGE_WALLET_READY_TYPE,
        protocolVersion: AGE_WALLET_PROTOCOL_VERSION,
      },
      popup,
    );
    harness.emit(successResponse(request), popup);
    assert.equal((await pending).status, "SUCCESS");
    harness.assertClean();
  });

  await t.test("user rejection", async () => {
    const request = proofRequest();
    const popup = { closed: false, postMessage() {} } as unknown as Window;
    const harness = transportHarness(Date.now());
    const pending = waitForWalletProof(
      request,
      popup,
      "http://127.0.0.1:5174",
      harness.runtime,
    );
    harness.emit(
      {
        type: AGE_WALLET_RESPONSE_TYPE,
        protocolVersion: AGE_WALLET_PROTOCOL_VERSION,
        status: "REJECTED",
        requestId: request.requestId,
        challengeId: request.challengeId,
        code: "USER_REJECTED",
        message: "Khách hàng từ chối.",
      },
      popup,
    );
    await assert.rejects(pending, /từ chối/);
    harness.assertClean();
  });

  await t.test("popup close", async () => {
    const request = proofRequest();
    const popup = { closed: false, postMessage() {} } as unknown as Window;
    const harness = transportHarness(Date.now());
    const pending = waitForWalletProof(
      request,
      popup,
      "http://127.0.0.1:5174",
      harness.runtime,
    );
    Object.assign(popup, { closed: true });
    harness.fireClosedTimer();
    await assert.rejects(pending, /đóng Ví/);
    harness.assertClean();
  });

  await t.test("request timeout", async () => {
    const request = proofRequest();
    const popup = { closed: false, postMessage() {} } as unknown as Window;
    const harness = transportHarness(Date.now());
    const pending = waitForWalletProof(
      request,
      popup,
      "http://127.0.0.1:5174",
      harness.runtime,
    );
    harness.fireTimeout();
    await assert.rejects(pending, /hết thời gian/);
    harness.assertClean();
  });
});

test("Wallet rejects artifact bytes with the wrong pinned SHA-256", async () => {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  const expected = createHash("sha256").update(bytes).digest("hex");
  assert.equal(await verifyArtifactHash(bytes, expected), bytes);
  await assert.rejects(
    () => verifyArtifactHash(bytes, "0".repeat(64)),
    /không khớp phiên bản đã được hệ thống tin cậy/,
  );
});

test("Public Wallet response schema rejects private credential fields", () => {
  const request = proofRequest();
  const leaked = {
    type: AGE_WALLET_RESPONSE_TYPE,
    protocolVersion: AGE_WALLET_PROTOCOL_VERSION,
    status: "SUCCESS",
    requestId: request.requestId,
    challengeId: request.challengeId,
    proofBundle: {
      challengeId: request.challengeId,
      credential: {
        metadata: {
          domain: "BVV-AGE-CREDENTIAL",
          schemaVersion: 1,
          circuitVersion: 1,
          credentialId: randomUUID(),
          issuerId: AGE_ISSUER_ID,
          commitment: "1",
          userIdHash: "2",
          issuedAt: "1",
          expiresAt: "2",
          issuerKeyVersion: 1,
        },
        issuerFingerprint: "a".repeat(64),
        signature: "A".repeat(86),
        privateInputs: { dobDay: "1", salt: "2", holderSecret: "3" },
      },
      proof: {
        pi_a: ["1", "1", "1"],
        pi_b: [
          ["1", "1"],
          ["1", "1"],
          ["1", "1"],
        ],
        pi_c: ["1", "1", "1"],
        protocol: "groth16",
        curve: "bn128",
      },
      publicSignals: ["1", "2", "3", "4"],
    },
    timings: {
      cache: "cold",
      wasmLoadMs: 1,
      zkeyLoadMs: 1,
      proofMs: 1,
      walletTotalMs: 3,
      consentedAtEpochMs: Date.now(),
    },
  };
  assert.equal(ageProofResponseSchema.safeParse(leaked).success, false);
});

test("Wallet UI keeps an independent identity and safe recovery hierarchy", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(app, /<strong>Ví xác minh<\/strong>/);
  assert.match(app, /Lưu giữ thông tin xác minh và tạo bằng chứng theo sự đồng ý của bạn/);
  assert.match(app, /Nâng cao \/ Khôi phục từ tệp/);
  assert.match(html, /Ví xác minh · Ví ZKP riêng tư/);
  assert.doesNotMatch(html, /Bản Vị Việt/);
});

test("Wallet UI explains disclosure and uses an in-app destructive confirmation", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  assert.match(app, /Website chỉ nhận kết quả đủ hoặc không đủ tuổi/);
  assert.match(app, /Không gồm ngày sinh hoặc dữ liệu bí mật/);
  assert.match(app, /role="dialog"/);
  assert.match(app, /Xóa credential khỏi thiết bị\?/);
  assert.doesNotMatch(app, /window\.confirm/);
});

test("Wallet UI only offers fixed Website return links after terminal flows", () => {
  const app = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  assert.match(app, /new URL\("\/tai-khoan", allowedWebsite\)/);
  assert.match(app, /claimComplete &&/);
  assert.match(app, /requestFinished &&/);
  assert.doesNotMatch(app, /returnUrl/);
});
