import type { EnvelopeVocabulary } from "@foreverworks/mcp-kit";

/**
 * The shell-callable health check every receipts server has (`--health`).
 *
 * THE OUTPUT IS THE CONTRACT, not just the exit code. Every line starts with
 * the server's label (`BOLT:`, `GLOVO:`), so a caller can tell "this ran and
 * reached a verdict" from "this crashed before it could say anything", which
 * would otherwise be reported as a dead token.
 *
 *   0  alive
 *   1  a human has to act: the token was refused or credentials are missing
 *      (or, where the app says when, the token expires soon)
 *   2  transient: the app or the network was unwell. Deliberately NOT an alarm.
 */
export const OK = 0;
export const PERMANENT = 1;
export const TRANSIENT = 2;

/** What the check reads from a failure: every receipts server's `auth` failures say whether they are permanent. */
export type HealthFailure = { readonly kind: string; readonly message: string; readonly permanent?: boolean };

export type HealthCli<H, E extends HealthFailure> = {
  readonly label: string;
  readonly check: () => Promise<H>;
  /** A check that ran to the end: its exit code, and its line after the label. */
  readonly verdict: (health: H) => { readonly exit: number; readonly line: string };
  readonly vocabulary: EnvelopeVocabulary<E>;
};

export const runHealthCli = async <H, E extends HealthFailure>(
  { label, check, verdict, vocabulary }: HealthCli<H, E>,
  log: (line: string) => void = console.log,
): Promise<number> => {
  try {
    const { exit, line } = verdict(await check());
    log(`${label}: ${line}`);
    return exit;
  } catch (thrown) {
    const error = vocabulary.asAppError(thrown);
    if (!error) {
      log(`${label}: FAIL unexpected: ${String(thrown)}`);
      return PERMANENT;
    }
    const permanent = error.kind === "config" || (error.kind === "auth" && error.permanent === true);
    log(`${label}: ${permanent ? "FAIL" : "WARN"} ${error.message} -- ${vocabulary.remedyFor(error)}`);
    return permanent ? PERMANENT : TRANSIENT;
  }
};
