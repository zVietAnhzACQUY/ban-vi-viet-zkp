/// <reference lib="webworker" />
import type {
  AgeCredentialFile,
  AgeProofRequest,
} from "../../shared/age-wallet";
import { createAgeProofInWallet } from "./proof";

type Request = {
  credential: AgeCredentialFile;
  request: AgeProofRequest;
  consentedAtEpochMs: number;
};

self.onmessage = async (event: MessageEvent<Request>) => {
  try {
    const result = await createAgeProofInWallet(
      event.data.credential,
      event.data.request,
      (progress) => self.postMessage({ type: "PROGRESS", ...progress }),
    );
    self.postMessage({
      ok: true,
      proofBundle: result.proofBundle,
      timings: {
        ...result.timings,
        consentedAtEpochMs: event.data.consentedAtEpochMs,
      },
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      message:
        error instanceof Error
          ? error.message
          : "Không thể hoàn tất xác minh trên thiết bị.",
    });
  }
};

export {};
