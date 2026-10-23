import { compact, sha256Of } from "@foreverworks/mcp-kit";

import { apiError, fail, inputError } from "../../domain/errors.js";
import { parseMessageId } from "../../domain/ids.js";
import { anafSealVerdict } from "../../domain/seal.js";
import type { Deps } from "../ports.js";
import { archiveContents, fetchArchive, outboxArchive } from "./archive.js";
import { describeRead, type DocumentInput, given, readDocument } from "./inputFiles.js";

export type VerifySignatureArgs = {
  readonly messageId: string;
  readonly archive: string;
  /** The two files, by path or as a script's checked base64: byte-exact either way. */
  readonly xml: DocumentInput;
  readonly signature: DocumentInput;
  readonly test: boolean;
};

/**
 * The invoice and its seal, from exactly one of three places. Only a message
 * id costs one of ANAF's ten downloads a day per message; an archive already
 * in the outbox, or the two files kept elsewhere, cost none. The two files go
 * byte for byte, by path or as a script's base64 checked against its sha256,
 * because the seal's digest is over the invoice's exact bytes.
 */
const pairOf = async (deps: Deps, args: VerifySignatureArgs) => {
  const files = given(args.xml) || given(args.signature);
  const sources = [args.messageId !== "", args.archive !== "", files].filter(Boolean).length;
  if (sources !== 1) return fail(inputError("give one of: message_id, archive, or the invoice with its signature (xml and signature, each { path } or { content_base64, sha256 })"));
  if (files) {
    const invoice = await readDocument(deps.files.readInput, args.xml);
    const seal = await readDocument(deps.files.readInput, args.signature);
    if (invoice === undefined || seal === undefined) {
      return fail(inputError("the invoice and its signature go together: xml and signature, each { path } or { content_base64, sha256 }"));
    }
    return { invoice: invoice.bytes, seal: seal.bytes, source: { invoice: describeRead(invoice), signature: describeRead(seal) } };
  }
  const [label, bytes, source] =
    args.messageId !== ""
      ? await (async () => {
          const messageId = parseMessageId(args.messageId);
          return [`for message ${messageId}`, await fetchArchive(deps, messageId, args.test), { messageId }] as const;
        })()
      : await (async () => {
          const path = outboxArchive(deps, args.archive);
          return [path, await deps.files.readFile(path), { archive: path }] as const;
        })();
  const { invoice, seal } = archiveContents(deps, label, bytes);
  if (seal === undefined) return fail(apiError(200, `the archive ${label} holds no semnatura_*.xml: it is not as ANAF served it`));
  return { invoice, seal, source: { ...source, sha256: sha256Of(bytes), bytes: bytes.length } };
};

/**
 * Is this invoice the one ANAF stored, under ANAF's seal?
 *
 * Checked HERE first (infra/seal.ts: the certificate against the pinned CA
 * and the Ministry's identifier, the RSA signature over SignedInfo, the
 * digest over the invoice's raw bytes), which costs no call and works when
 * ANAF is down. When that check cannot decide (a CA or an algorithm it does
 * not know, a signature it cannot verify), ANAF's /api/validate/signature
 * decides, and the result says which one answered and why.
 */
export const verifySignature = async (deps: Deps, args: VerifySignatureArgs) => {
  const { invoice, seal, source } = await pairOf(deps, args);
  const reading = deps.readInvoice(invoice.toString("utf8"));
  const facts = reading.kind === "invoice" ? reading.facts : undefined;
  const local = deps.checkSeal(invoice, seal, { nowEpoch: deps.now(), issuedOn: facts?.issueDate });
  const about = { source, invoice: facts ?? { unreadable: reading.kind === "unreadable" ? reading.why : "" } };
  if (local.verdict !== "inconclusive")
    return compact({
      valid: local.verdict === "valid",
      checkedBy: "local" as const,
      reason: local.verdict === "invalid" ? local.reason : undefined,
      certificate: local.certificate,
      ...about,
    });

  const answer = await deps.anaf.verifySeal(invoice, seal);
  const valid = anafSealVerdict(answer.msg);
  if (valid === undefined) return fail(apiError(200, "ANAF answered neither of its two documented verdicts", { body: answer }));
  return compact({
    valid,
    checkedBy: "anaf" as const,
    anafSays: answer.msg,
    localInconclusive: local.reason,
    certificate: local.certificate,
    ...about,
  });
};
