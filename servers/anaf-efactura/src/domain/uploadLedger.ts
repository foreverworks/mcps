/**
 * What this server has sent to ANAF PRODUCTION, by the SHA-256 of the exact
 * bytes: a lost answer followed by a retry must not file the same invoice
 * twice. An entry is written BEFORE the upload is sent and settled after, so a
 * call that died between the two leaves `unknown` behind, which refuses the
 * same bytes until someone has looked (upload_status, list_invoices) and says
 * `refile`. Test uploads have no legal effect and are not recorded. One ledger
 * for every filing (an invoice, a B2C invoice, an e-Transport declaration):
 * the same bytes are one document, whichever way they were sent.
 */
export type LedgerOutcome =
  /** Sent, and nothing heard yet: the process may have died mid-call. */
  | "sent"
  /** The call failed after the request may have reached ANAF. */
  | "unknown"
  /** ANAF took it: `uploadId` says which upload. */
  | "accepted"
  /** ANAF answered and refused it. */
  | "refused"
  /** The call failed before anything could reach ANAF. */
  | "not_filed";

/** What was filed: an e-Factura invoice (the default, and every entry before B2C), a B2C invoice, or an e-Transport declaration. */
export type LedgerKind = "invoice" | "b2c" | "etransport";

export type LedgerEntry = {
  readonly sha256: string;
  readonly kind?: LedgerKind | undefined;
  readonly cif: string;
  /** ISO 8601, when it was sent. */
  readonly at: string;
  readonly outcome: LedgerOutcome;
  readonly uploadId?: string | undefined;
};

/** Why these exact bytes may not go to production again, or undefined to go ahead. */
export const refileProblem = (earlier: LedgerEntry | undefined, refile: boolean): string | undefined => {
  if (earlier === undefined || refile) return undefined;
  if (earlier.outcome === "refused" || earlier.outcome === "not_filed") return undefined;
  const check = earlier.kind === "etransport" ? "etransport_status or etransport_list" : "upload_status or list_invoices";
  const what =
    earlier.outcome === "accepted"
      ? `ANAF accepted it as upload ${earlier.uploadId ?? "(no id)"}`
      : earlier.outcome === "sent"
        ? "no answer is recorded yet (the call is in flight, or died before ANAF answered)"
        : "its outcome is unknown (the answer was lost)";
  return (
    `this exact file (sha256 ${earlier.sha256.slice(0, 12)}...) was already sent to ANAF production for CIF ${earlier.cif} ` +
    `on ${earlier.at}, and ${what}; check ${check} first, and pass refile: true only to file it again`
  );
};
