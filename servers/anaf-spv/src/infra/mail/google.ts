import type { CodeWatch } from "../../app/ports.js";
import { codesIn, firstNewCode } from "../../domain/codes.js";
import { fail, upstreamError } from "../../domain/errors.js";
import { type Connection, succeeded, type ToolInfo } from "../upstream/mcp.js";
import { type Poll, polling } from "./poll.js";

/**
 * The driver for a Gmail server shaped like this repository's `google`
 * server: `search_threads` (Gmail query syntax, an `account` label, thread
 * summaries with the latest message's snippet) and `get_thread` (every
 * message of a thread with its `internalDate` and body as text).
 *
 * Gmail files every SPV code in one thread, so a new code shows as a changed
 * snippet on a thread the watch saw at its start (or as a new thread). The
 * thread is then read, and the code is taken from the newest message that
 * arrived after the watch began and carries a code not seen at the start.
 */
export const GOOGLE_TOOLS = { search: "search_threads", read: "get_thread" } as const;

/** Whether a server has the two tools, with the arguments this driver sends. */
export const looksLikeGoogle = (tools: readonly ToolInfo[]): boolean => {
  const search = tools.find((t) => t.name === GOOGLE_TOOLS.search);
  const read = tools.find((t) => t.name === GOOGLE_TOOLS.read);
  return search !== undefined && read !== undefined && search.properties.includes("query") && read.properties.includes("thread_id");
};

/** The wire shapes, every field optional (servers/google, search_threads and get_thread). */
type ThreadSummaryWire = { readonly account?: string; readonly id?: string; readonly snippet?: string };
type SearchWire = { readonly threads?: readonly ThreadSummaryWire[] };
type MessageWire = { readonly id?: string; readonly internalDate?: string | number; readonly body?: string; readonly snippet?: string };
type ThreadWire = { readonly messages?: readonly MessageWire[] };

/** A message dated this much before the watch began still counts: Gmail's clock and this host's may differ a little. */
const SKEW_MS = 60_000;

const objectOr = <T>(value: unknown, what: string): T =>
  typeof value === "object" && value !== null ? (value as T) : fail(upstreamError("mail", `${what} did not answer JSON`));

export type GoogleOptions = { readonly query: string; readonly account: string | undefined; readonly poll: Poll };

export const watchGoogle = async (connection: Connection, options: GoogleOptions): Promise<CodeWatch> => {
  const account = options.account ?? "*";
  const search = async (): Promise<readonly ThreadSummaryWire[]> => {
    const answer = succeeded("mail", GOOGLE_TOOLS.search, await connection.call(GOOGLE_TOOLS.search, { query: options.query, max_results: 5, account }));
    return objectOr<SearchWire>(answer.json, GOOGLE_TOOLS.search).threads ?? [];
  };
  const keyOf = (t: ThreadSummaryWire): string => `${t.account ?? ""}/${t.id ?? ""}`;

  const startedAt = options.poll.now();
  const before = await search();
  const snippets = new Map(before.map((t) => [keyOf(t), t.snippet ?? ""]));
  const seenCodes = new Set(before.flatMap((t) => codesIn(t.snippet ?? "")));

  const check = async (): Promise<string | undefined> => {
    const changed = (await search()).filter((t) => t.id !== undefined && snippets.get(keyOf(t)) !== (t.snippet ?? ""));
    for (const t of changed) {
      const args = { thread_id: t.id ?? "", detail: "text", ...(t.account === undefined ? (account === "*" ? {} : { account }) : { account: t.account }) };
      const thread = objectOr<ThreadWire>(succeeded("mail", GOOGLE_TOOLS.read, await connection.call(GOOGLE_TOOLS.read, args)).json, GOOGLE_TOOLS.read);
      const recent = (thread.messages ?? [])
        .map((m) => ({ at: Number(m.internalDate ?? 0), text: `${m.body ?? ""}\n${m.snippet ?? ""}` }))
        .filter((m) => m.at >= startedAt - SKEW_MS)
        .sort((a, b) => b.at - a.at);
      for (const m of recent) {
        const code = firstNewCode(codesIn(m.text), seenCodes);
        if (code !== undefined) return code;
      }
    }
    return undefined;
  };

  return { next: (deadlineMs) => polling(options.poll, deadlineMs, check), close: () => connection.close() };
};
