import { asAppError, fail, inputError, OUTCOME_UNKNOWN } from "../../domain/errors.js";
import type { LedgerEntry } from "../../domain/uploadLedger.js";
import type { Deps } from "../ports.js";

/**
 * A production filing, through the ledger (domain/uploadLedger.ts): claims the
 * bytes (refused when an earlier entry says so), sends, and settles the entry
 * with what came of it. An answer lost after the request may have reached ANAF
 * is recorded `unknown`, which refuses the same bytes until someone has looked.
 * Every filing tool goes through here: upload_invoice, upload_invoice_b2c and
 * etransport_file.
 */
export const filed = async <T extends { readonly accepted: boolean; readonly uploadId: string | undefined }>(
  deps: Deps,
  entry: Omit<LedgerEntry, "outcome" | "uploadId">,
  refile: boolean,
  send: () => Promise<T>,
): Promise<T> => {
  const claim = await deps.uploads.reserve(entry, refile);
  if (!claim.ok) fail(inputError(claim.problem));
  try {
    const receipt = await send();
    await deps.uploads.record({ ...entry, outcome: receipt.accepted ? "accepted" : "refused", uploadId: receipt.uploadId });
    return receipt;
  } catch (thrown) {
    const unknown = asAppError(thrown)?.kind === "api" && (asAppError(thrown) as { reason?: string }).reason === OUTCOME_UNKNOWN;
    await deps.uploads.record({ ...entry, outcome: unknown ? "unknown" : "not_filed" });
    throw thrown;
  }
};
