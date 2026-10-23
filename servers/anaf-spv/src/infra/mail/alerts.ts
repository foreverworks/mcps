import { addDays } from "@foreverworks/mcp-kit";

import type { AlertMail, AlertsPort } from "../../app/ports.js";
import { ALERT_QUERY } from "../../domain/alerts.js";
import { configError, fail, upstreamError } from "../../domain/errors.js";
import { decodeEntities } from "../portal/html.js";
import { succeeded } from "../upstream/mcp.js";
import { GOOGLE_TOOLS, looksLikeGoogle } from "./google.js";
import type { MailConfig } from "./source.js";

/**
 * SPV's alert e-mails, read through the mail MCP server the codes come from,
 * which must be shaped like this repository's google server: search_threads
 * for the alerts, get_thread with raw_html for each one's lines. Reads only.
 */

type ThreadWire = { readonly account?: string; readonly id?: string };
type PageWire = { readonly account?: string; readonly nextPageToken?: string };
type SearchWire = { readonly threads?: readonly ThreadWire[]; readonly accounts?: readonly PageWire[] };
type MessageWire = { readonly id?: string; readonly internalDate?: string | number; readonly body?: string; readonly bodySource?: string };
type ThreadBodyWire = { readonly messages?: readonly MessageWire[] };

const objectOr = <T>(value: unknown, what: string): T =>
  typeof value === "object" && value !== null ? (value as T) : fail(upstreamError("mail", `${what} did not answer JSON`));

/** A body's lines as a person reads them: `<br>` and block ends break lines, tags go, entities decode. */
export const bodyLines = (body: string): readonly string[] =>
  decodeEntities(
    body
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr|h\d)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);

/** Gmail's after:/before: are whole days in the mailbox's time zone, so the search takes a day more each side and the use case cuts exactly. */
const range = (since: string | undefined, until: string | undefined): string =>
  [...(since === undefined ? [] : [`after:${addDays(since, -1).replaceAll("-", "/")}`]), ...(until === undefined ? [] : [`before:${addDays(until, 2).replaceAll("-", "/")}`])].join(" ");

const PAGE = 50;

export const makeAlertSource = (config: MailConfig): AlertsPort => ({
  read: async ({ since, until, limit }) => {
    if (config.driver === "manual") {
      return fail(configError("posting dates are read from SPV's alert e-mails, through the mail MCP server (ANAF_SPV_MAIL_MCP_URL or ANAF_SPV_MAIL_MCP_COMMAND)"));
    }
    const connection = await config.connect();
    try {
      if (config.driver !== "google" && !looksLikeGoogle(await connection.tools())) {
        fail(configError(`posting dates need a mail server with ${GOOGLE_TOOLS.search} and ${GOOGLE_TOOLS.read} (this repository's google server), which ${config.endpoint} lacks`));
      }
      const account = config.account ?? "*";
      const query = [ALERT_QUERY, range(since, until)].filter((q) => q !== "").join(" ");
      const threads: ThreadWire[] = [];
      let pageToken = "";
      let more = false;
      for (;;) {
        const args = { query, max_results: PAGE, account, ...(pageToken === "" ? {} : { page_token: pageToken }) };
        const page = objectOr<SearchWire>(succeeded("mail", GOOGLE_TOOLS.search, await connection.call(GOOGLE_TOOLS.search, args)).json, GOOGLE_TOOLS.search);
        threads.push(...(page.threads ?? []).filter((t) => t.id !== undefined));
        // Gmail's page tokens are per mailbox: follow one only when one mailbox is searched.
        const next = account === "*" ? undefined : page.accounts?.find((a) => a.nextPageToken)?.nextPageToken;
        more = (page.accounts ?? []).some((a) => a.nextPageToken);
        if (threads.length >= limit || next === undefined) break;
        pageToken = next;
      }
      const mails: AlertMail[] = [];
      for (const t of threads.slice(0, limit)) {
        const args = { thread_id: t.id ?? "", detail: "raw_html", ...(t.account === undefined ? (account === "*" ? {} : { account }) : { account: t.account }) };
        const thread = objectOr<ThreadBodyWire>(succeeded("mail", GOOGLE_TOOLS.read, await connection.call(GOOGLE_TOOLS.read, args)).json, GOOGLE_TOOLS.read);
        for (const m of thread.messages ?? []) {
          if (m.id === undefined || m.internalDate === undefined) continue;
          mails.push({ id: m.id, receivedAtMs: Number(m.internalDate), lines: bodyLines(m.body ?? "") });
        }
      }
      return { mails, more: more || threads.length > limit };
    } finally {
      await connection.close();
    }
  },
});
