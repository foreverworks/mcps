import { join } from "node:path";

import { readJsonFile, withFileLock, writeJsonFile } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { UploadLedgerPort } from "../app/ports.js";
import { type LedgerEntry, refileProblem } from "../domain/uploadLedger.js";

const entry = z.object({
  kind: z.enum(["invoice", "b2c", "etransport"]).optional(),
  cif: z.string(),
  at: z.string(),
  outcome: z.enum(["sent", "unknown", "accepted", "refused", "not_filed"]),
  upload_id: z.string().optional(),
});
const file = z.record(z.string(), entry);
type OnDisk = z.infer<typeof file>;

/**
 * `<state dir>/uploads.json` (0600): production uploads by the SHA-256 of
 * their bytes (domain/uploadLedger.ts). `reserve` reads, judges and writes
 * under one lock, so two calls cannot both find no entry for the same bytes
 * (the live case: a client that times out and sends the same file again while
 * the first call is still at ANAF). A file that does not parse reads as empty
 * rather than blocking every upload; the next write replaces it.
 */
export const makeUploadLedger = (stateDir: string): UploadLedgerPort => {
  const path = join(stateDir, "uploads.json");
  const load = async (): Promise<OnDisk> => {
    const parsed = file.safeParse(await readJsonFile<unknown>(path));
    return parsed.success ? parsed.data : {};
  };
  const entryOf = (sha256: string, all: OnDisk): LedgerEntry | undefined => {
    const found = all[sha256];
    return found === undefined ? undefined : { sha256, kind: found.kind, cif: found.cif, at: found.at, outcome: found.outcome, uploadId: found.upload_id };
  };
  const put = async (all: OnDisk, e: LedgerEntry): Promise<void> =>
    writeJsonFile(path, {
      ...all,
      [e.sha256]: { ...(e.kind === undefined ? {} : { kind: e.kind }), cif: e.cif, at: e.at, outcome: e.outcome, ...(e.uploadId === undefined ? {} : { upload_id: e.uploadId }) },
    });
  return {
    find: async (sha256) => entryOf(sha256, await load()),
    reserve: (e, refile) =>
      withFileLock(stateDir, "uploads.lock", async () => {
        const all = await load();
        const problem = refileProblem(entryOf(e.sha256, all), refile);
        if (problem !== undefined) return { ok: false as const, problem };
        await put(all, { ...e, outcome: "sent" });
        return { ok: true as const };
      }),
    record: (e: LedgerEntry) => withFileLock(stateDir, "uploads.lock", async () => put(await load(), e)),
  };
};
