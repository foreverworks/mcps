import { makeErrorKit, makeRequired } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data (no classes, no
 * `instanceof`: the tag survives serialisation and a module boundary).
 *
 * `account` is the workspace label a failure happened in, when there was one.
 * Two workspaces answer through one server, and "the token was refused" is only
 * actionable when it says whose.
 */
export type AppError =
  /** No token files, an unreadable one, an account label nobody configured; or no outbox (`variable`) for a tool that saves files. */
  | { readonly kind: "config"; readonly message: string; readonly variable?: typeof OUTBOX_VARIABLE }
  /** 401: the workspace's integration token was refused (revoked, or the integration was deleted). */
  | { readonly kind: "auth"; readonly account: string; readonly message: string }
  /**
   * 404 in every workspace asked: the id does not exist, or its page was never
   * shared with that workspace's integration, which Notion does not tell apart.
   */
  | { readonly kind: "not_shared"; readonly id?: string; readonly accounts: readonly string[]; readonly message: string }
  /** 403: the integration lacks a capability (read, update or insert content; comments). */
  | { readonly kind: "forbidden"; readonly account: string; readonly message: string }
  /** The arguments cannot become a request, or Notion refused them as invalid. Nothing changed. */
  | { readonly kind: "input"; readonly message: string; readonly code?: string }
  /** 409 after the retries: Notion saw a concurrent edit to the same object. Nothing changed. */
  | { readonly kind: "conflict"; readonly account: string; readonly message: string }
  /** 429 after the retries: the integration's 180 requests a minute, or the workspace's own limit. */
  | { readonly kind: "rate_limited"; readonly account: string; readonly message: string }
  /** A write that failed AFTER it may have reached Notion: a 5xx or a dropped connection. */
  | { readonly kind: "outcome_unknown"; readonly account: string; readonly message: string }
  /** Notion was unreachable or unwell (5xx on a read), or answered in a shape it does not document. */
  | {
      readonly kind: "api";
      readonly account?: string;
      readonly status: number;
      readonly message: string;
      readonly code?: string;
      /** `drift` for an answer without a field Notion documents; absent otherwise. */
      readonly reason?: string;
    };

export type Kind = AppError["kind"];

/** Where download_files saves; it has no default, so a deployment says where its callers can read. */
export const OUTBOX_VARIABLE = "NOTION_OUTBOX_DIR";

export const configError = (message: string): AppError => ({ kind: "config", message });
export const inputError = (message: string, code?: string): AppError => ({ kind: "input", message, ...(code === undefined ? {} : { code }) });

export const { fail, asAppError } = makeErrorKit<AppError>("notion");

/** The `reason` on an answer that lacks a field Notion's own types promise. */
export const DRIFT = "drift";

/**
 * A field the wire types call optional that this call cannot do without. Its
 * absence is Notion's shape changing, said loudly rather than carried on as an
 * empty value.
 */
export const required = makeRequired((what) => fail({ kind: "api", status: 0, message: `Notion's answer had no ${what}`, reason: DRIFT }));

const SHARE =
  "open it in Notion, then ••• > Connections > add this workspace's integration (every page under it inherits " +
  "the access); a page created at the top level of a workspace later has to be shared the same way";

/** What to do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      return error.variable === OUTBOX_VARIABLE
        ? `set ${OUTBOX_VARIABLE} to a folder this server may write and its callers may read; downloaded files are saved there`
        : "put one token per workspace, as a file named notion-<label> (notion-work, say), in the directory NOTION_TOKENS_DIR names (or CREDENTIALS_DIRECTORY under systemd)";
    case "auth":
      return `the token of "${error.account}" was refused (revoked, or a personal access token past its expiry): make a new one at https://www.notion.so/developers/tokens and replace the notion-${error.account} file; it is re-read on the next call`;
    case "not_shared":
      return `not found in ${error.accounts.map((a) => `"${a}"`).join(" or ")}: check the id, or share the page with the integration: ${SHARE}`;
    case "forbidden":
      return `the "${error.account}" integration lacks a capability for this: turn on read, update and insert content and the comment capabilities at https://www.notion.so/profile/integrations`;
    case "input":
      return "fix the arguments and call again; nothing was changed";
    case "conflict":
      return "someone edited the same object at the same moment; read it again, then retry";
    case "rate_limited":
      return "Notion is throttling this integration (180 requests a minute on the Free plan); wait a minute and retry";
    case "outcome_unknown":
      return "read the page (read_page) before writing again: the change may already be there, and repeating an append adds it twice";
    case "api":
      if (error.reason === DRIFT) return "Notion's answer changed shape; the server needs updating, report it";
      return error.status === 0 ? "Notion was unreachable; retry later" : "Notion failed; retry later, and report it if it persists";
  }
};

/** A failure's message and remedy on one line, for the sections of a multi-account answer. */
export const describeThrown = (thrown: unknown): string => {
  const error = asAppError(thrown);
  return error === undefined ? `unexpected: ${String(thrown)}` : `${error.kind}: ${error.message} (${remedyFor(error)})`;
};
