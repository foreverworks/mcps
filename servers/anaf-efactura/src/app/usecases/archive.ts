import { createHash } from "node:crypto";

import { compact, resolveSaveDir, sha256Of } from "@foreverworks/mcp-kit";

import { looksLikeZip } from "../../domain/archive.js";
import { apiError, fail, inputError } from "../../domain/errors.js";
import type { ArchiveEntry, Deps } from "../ports.js";

/**
 * One filed message's signed archive, checked to BE an archive: ANAF answers
 * an unknown id with HTTP 200 and a JSON refusal, and bytes that are secretly
 * an error document are a problem that surfaces days later, in whatever tries
 * to open them. Both download_invoice and invoice_pdf start here.
 */
export const fetchArchive = async (deps: Deps, messageId: string, test: boolean): Promise<Buffer> => {
  const { bytes, refusal } = await deps.anaf.downloadMessage(messageId, test);
  if (!looksLikeZip(bytes))
    fail(
      apiError(
        200,
        refusal?.eroare === undefined
          ? `ANAF returned ${bytes.length} bytes that are not a ZIP for message ${messageId}`
          : `ANAF refused message ${messageId}: ${refusal.eroare}`,
        { body: refusal ?? bytes.subarray(0, 300).toString("utf8") },
      ),
    );
  return bytes;
};

const isSeal = (name: string): boolean => name.toLowerCase().startsWith("semnatura_");

/**
 * What an archive holds. ANAF packs two XML files: the document, named after
 * its upload, and its own seal, `semnatura_<id>.xml`. Anything other than
 * exactly one document is not an archive this server understands; the seal
 * is absent only from an archive someone else repacked. Both come back as the
 * bytes they are, because the seal's digest is over the raw file.
 */
const contentsOf = (label: string, entries: readonly ArchiveEntry[]) => {
  const documents = entries.filter((entry) => entry.name.toLowerCase().endsWith(".xml") && !isSeal(entry.name));
  const seals = entries.filter((entry) => isSeal(entry.name));
  const [only, ...rest] = documents;
  if (only === undefined || rest.length > 0) return fail(apiError(200, `the archive ${label} holds ${documents.length} invoice documents, not one`));
  return { invoice: only.data, seal: seals.length === 1 ? seals[0]?.data : undefined };
};

export const archiveContents = (deps: Deps, label: string, archive: Buffer) => contentsOf(label, deps.unzip(archive));

/**
 * How a saved file can be checked against a copy elsewhere: its SHA-256, and
 * its MD5, which is what some file stores (Google Drive among them) report.
 */
export const digestsOf = (bytes: Buffer) => ({ sha256: sha256Of(bytes), md5: createHash("md5").update(bytes).digest("hex") });

/**
 * A downloaded archive, checked before it is kept: every entry inflates to its
 * recorded CRC (readZip), it holds one document and ANAF's seal on it, and the
 * seal is checked here against the document's bytes, which is ANAF's own
 * checksum of what it stored. A ZIP that does not open, or holds no seal, is
 * not saved; a seal this code cannot verify, or one that fails, is reported
 * beside the saved file (verify_signature asks ANAF when local cannot decide).
 */
export const checkedArchive = (deps: Deps, label: string, archive: Buffer) => {
  const entries = deps.unzip(archive);
  const { invoice, seal } = contentsOf(label, entries);
  if (seal === undefined) return fail(apiError(200, `the archive ${label} holds no semnatura_*.xml: it is not as ANAF serves it; nothing was saved`));
  const reading = deps.readInvoice(invoice.toString("utf8"));
  const facts = reading.kind === "invoice" ? reading.facts : undefined;
  const local = deps.checkSeal(invoice, seal, { nowEpoch: deps.now(), issuedOn: facts?.issueDate });
  return {
    ...digestsOf(archive),
    bytes: archive.length,
    entries: entries.map((entry) => ({ name: entry.name, bytes: entry.data.length, sha256: sha256Of(entry.data) })),
    seal: compact({
      verdict: local.verdict,
      checkedBy: "local" as const,
      reason: local.verdict === "valid" ? undefined : local.reason,
    }),
    ...(facts === undefined ? {} : { invoice: facts }),
  };
};

/** The invoice inside a message's archive, as text. */
export const invoiceInArchive = (deps: Deps, messageId: string, archive: Buffer): string =>
  archiveContents(deps, `for message ${messageId}`, archive).invoice.toString("utf8");

/** An archive already in the outbox (download_invoice put it there), named by its path or its name under the outbox. */
export const outboxArchive = (deps: Deps, requested: string): string => {
  const slash = requested.lastIndexOf("/");
  const name = requested.slice(slash + 1);
  if (!/^[A-Za-z0-9_.-]+\.zip$/.test(name)) return fail(inputError(`archive must name a .zip file, got "${name}"`));
  const where = resolveSaveDir(deps.paths.downloadsDir, slash < 0 ? "" : requested.slice(0, slash));
  if (!where.ok) return fail(inputError(where.reason.replace("save_dir", "archive")));
  return `${where.dir}/${name}`;
};
