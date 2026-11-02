import type { Deps as ConsentDeps } from "./consent/app/ports.js";
import type { Registry as GmailRegistry } from "./gmail/composition.js";
import { googleStateDir, oauthClientOf, stateDirFrom } from "./infra/locations.js";

/**
 * Where the server's configuration came from: a variable, or what `setup`
 * (or a consent) saved under the state directory. health reports it, so a
 * person can tell a value they set from one the server found, and see which
 * one wins.
 */
export type ConfigReport = {
  readonly stateDir: { readonly path: string; readonly from: string };
  readonly oauthClient: { readonly path: string; readonly from: string } | { readonly path: null; readonly from: "none"; readonly note: string };
  readonly mailboxes: { readonly from: "GMAIL_MODIFY_ACCOUNTS" } | { readonly from: "grants"; readonly folder: string };
  readonly accounts: Readonly<Record<string, { readonly address: string; readonly from: string } | { readonly address: null; readonly from: "nothing yet" }>>;
};

export const configReport = (env: NodeJS.ProcessEnv, gmail: GmailRegistry, consent: ConsentDeps): ConfigReport => {
  const client = oauthClientOf(env);
  return {
    stateDir: { path: googleStateDir(env), from: stateDirFrom(env) },
    oauthClient: client
      ? client
      : { path: null, from: "none", note: "a consent borrows the OAuth client of a grant the account already has; run setup, or set GOOGLE_OAUTH_CLIENT_FILE" },
    mailboxes: gmail.grantRoot ? { from: "grants", folder: gmail.grantRoot } : { from: "GMAIL_MODIFY_ACCOUNTS" },
    accounts: Object.fromEntries(consent.known().map(([label, known]) => [label, known ?? { address: null, from: "nothing yet" as const }])),
  };
};

/** The report as `CONFIG:` lines, for the shell's health check. */
export const configLines = (report: ConfigReport): readonly string[] => [
  `CONFIG: state ${report.stateDir.path} (from ${report.stateDir.from})`,
  report.oauthClient.path === null ? `CONFIG: oauth client none (${report.oauthClient.note})` : `CONFIG: oauth client ${report.oauthClient.path} (from ${report.oauthClient.from})`,
  report.mailboxes.from === "grants" ? `CONFIG: mailboxes the grants under ${report.mailboxes.folder}` : "CONFIG: mailboxes from GMAIL_MODIFY_ACCOUNTS",
  ...Object.entries(report.accounts).map(([label, a]) => `CONFIG: account=${label} address=${a.address ?? "?"} (from ${a.from})`),
];
