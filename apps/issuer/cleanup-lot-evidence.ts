import type { PrismaClient } from "../api/generated/client/index.js";
import { hasEvidenceCiphertext, removeEvidence, type EvidenceStorage } from "./evidence-storage.js";

type CleanupOptions = {
  apply?: boolean;
  now?: Date;
  retentionHours?: number;
  // Optional internal scope. The production CLI retains its retention-wide scan.
  requestId?: string;
};

export async function cleanupLotEvidence(db: PrismaClient, storage: EvidenceStorage, options: CleanupOptions = {}) {
  const hours = options.retentionHours ?? 24;
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) throw new Error("Retention must be 1–168 hours.");
  if (options.requestId !== undefined && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(options.requestId))
    throw new Error("Cleanup request scope must be a UUID.");
  const now = options.now ?? new Date(), cutoff = new Date(now.getTime() - hours * 3600000);
  const terminal = ["ISSUED", "REJECTED", "REVOKED", "EXPIRED"] as const;
  const rows = await db.lotVerificationEvidence.findMany({
    where: {
      deletedAt: null,
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      request: { status: { in: [...terminal] }, updatedAt: { lte: cutoff } },
    },
    select: { id: true, requestId: true, storageKey: true },
  });
  const candidates: typeof rows = [];
  let unavailable = 0, removed = 0;
  for (const row of rows) {
    if (await hasEvidenceCiphertext(storage, row.storageKey, "LOT")) candidates.push(row);
    else unavailable++;
  }
  if (options.apply) for (const row of candidates) {
    const deleted = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "LotCredentialRequest" WHERE id=${row.requestId}::uuid FOR UPDATE`;
      const e = await tx.lotVerificationEvidence.findUnique({ where: { id: row.id }, include: { request: true } });
      if (!e || e.deletedAt || e.requestId !== row.requestId || e.storageKey !== row.storageKey ||
          !(terminal as readonly string[]).includes(e.request.status) || e.request.updatedAt > cutoff) return false;
      // Recheck after locking. A missing file (including an unlink/DB crash gap) requires
      // reconciliation, never an automatic deletedAt update or a successful removal count.
      if (!await hasEvidenceCiphertext(storage, e.storageKey, "LOT"))
        throw new Error("LOT cleanup ciphertext unavailable; metadata unchanged.");
      await removeEvidence(storage, e.storageKey, "LOT", { requireExisting: true });
      await tx.lotVerificationEvidence.update({ where: { id: e.id }, data: { deletedAt: now, originalName: "deleted" } });
      return true;
    });
    if (deleted) removed++;
  }
  // eligible counts local regular LOT files, unavailable counts metadata without
  // one, and removed counts only successful unlinks whose metadata transaction committed.
  return { dryRun: !options.apply, eligible: candidates.length, unavailable, removed };
}
