import { readFile } from "node:fs/promises";
import { hostname } from "node:os";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import type { Progress } from "../call.js";

/** A pause that ends early when the call is cancelled. */
const pause = (ms: number, signal: AbortSignal | undefined): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * `MCP_CONFIRM=approvals`: before a `money` call (or a `write` its policy
 * marks `confirm`) runs, the server asks a person through an approval service
 * of the deployment's own, waits for the verdict, and runs only on a yes.
 *
 * The question never passes through the client or the model that made the
 * call: the server files it with the service itself, over the service's own
 * token, and holds the call open until a person answers on their own device.
 * A prompt-injected agent can make the call, but it cannot answer for the
 * person, and the approved call runs on exactly the arguments the person read
 * (the call never leaves this process between the question and the run).
 *
 * The service is an MCP server reached over Streamable HTTP with a bearer
 * token, offering three tools (their names are settings, so any service that
 * speaks this shape fits):
 *
 * - request `{ connector: "approve", title, params: { action }, timeout_sec }`
 *   files the yes-or-no question and answers JSON text with its `id` and
 *   `status`. `action` is the one line the server's policy writes for the call
 *   (300 characters at most, one line), the line `elicit` would show;
 * - await `{ id, timeout_sec }` waits up to `timeout_sec` and answers the same
 *   JSON with the current `status`;
 * - cancel `{ id }` withdraws a question nobody needs answered any more.
 *
 * `status` is `pending` while nobody has answered, `approved` or `done` for a
 * yes, and anything else (`denied`, `expired`, `cancelled`, `failed`) is a no.
 * An answer the server cannot read, a service that cannot be reached, a token
 * that cannot be read, and no answer in time are all a no: the call is refused
 * and nothing runs. The tools' own errors may come as `{"error": {...}}` text.
 *
 * One limit is the service's to close: a question the service filed while the
 * request itself failed (a timeout, a dropped connection) has no id here, so
 * it cannot be withdrawn, and a yes to it runs nothing.
 */

export type ApprovalsSettings = {
  /** The service's MCP endpoint. */
  readonly url: URL;
  /** The file holding the bearer token for it, read on every question, so a rotated token needs no restart. */
  readonly tokenFile: string;
  /** How long a person has to answer, in seconds. */
  readonly timeoutSec: number;
  readonly tools: { readonly request: string; readonly await: string; readonly cancel: string };
  /** The `_meta` key a requester record goes under, for a service that shows who asks; none sends no record. */
  readonly requesterMeta?: string;
};

/** What a person is asked, and about which call. */
export type ApprovalAsk = {
  /** The server's name. */
  readonly service: string;
  readonly tool: string;
  /** The client the bearer token names that made the call ("stdio" over stdio). */
  readonly client: string;
  /** The policy's one line for the call, service name first. */
  readonly line: string;
  /** SHA-256 of the exact arguments, for the service's record. */
  readonly argsDigest: string;
};

export type Verdict =
  | { readonly kind: "approved" }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "unavailable"; readonly message: string };

export const DEFAULT_APPROVALS_TIMEOUT_SEC = 600;
export const DEFAULT_APPROVALS_TOOLS = { request: "request", await: "await", cancel: "cancel" } as const;

/** How long one wait at the service lasts at most: short enough that a cancelled call stops waiting soon. */
const AWAIT_STEP_SEC = 30;
/** The shortest round of waiting: a service that answers `pending` at once is not asked again sooner. */
const AWAIT_MIN_MS = 1000;
/**
 * How many questions one client may have open at once. A caller that files
 * question after question (a prompt-injected agent, say) would bury the person
 * in requests until one gets a careless yes; past this, a call is refused
 * before anything is filed.
 */
export const MAX_OPEN_PER_CLIENT = 3;

/** The questions open now, per client. */
const open = new Map<string, number>();
/** How long the service has to answer anything but a wait. */
const CALL_TIMEOUT_MS = 30_000;

const YES: readonly string[] = ["approved", "done"];

/** MCP_APPROVALS_*, read when MCP_CONFIRM=approvals; a setting that does not read is a process that must not start. */
export const approvalsSettingsFrom = (env: NodeJS.ProcessEnv): ApprovalsSettings => {
  const raw = env["MCP_APPROVALS_URL"]?.trim();
  if (!raw) throw new Error("MCP_CONFIRM=approvals needs MCP_APPROVALS_URL, the approval service's MCP endpoint");
  const url = ((): URL => {
    try {
      return new URL(raw);
    } catch {
      throw new Error(`MCP_APPROVALS_URL "${raw}" is not a URL`);
    }
  })();
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`MCP_APPROVALS_URL "${raw}" is not an http or https URL`);
  if (url.username !== "" || url.password !== "") throw new Error("MCP_APPROVALS_URL carries a user or password; put the token in MCP_APPROVALS_TOKEN_FILE");
  const tokenFile = env["MCP_APPROVALS_TOKEN_FILE"]?.trim();
  if (!tokenFile) throw new Error("MCP_CONFIRM=approvals needs MCP_APPROVALS_TOKEN_FILE, the file holding the service's bearer token");
  const timeoutRaw = env["MCP_APPROVALS_TIMEOUT_S"]?.trim();
  const timeoutSec = timeoutRaw ? Number(timeoutRaw) : DEFAULT_APPROVALS_TIMEOUT_SEC;
  if (!Number.isInteger(timeoutSec) || timeoutSec < 30 || timeoutSec > 3600) {
    throw new Error(`MCP_APPROVALS_TIMEOUT_S "${timeoutRaw ?? ""}" is not a whole number of seconds from 30 to 3600`);
  }
  const names = (env["MCP_APPROVALS_TOOLS"]?.trim() || "").split(",").map((n) => n.trim());
  const tools =
    names.length === 1 && names[0] === ""
      ? DEFAULT_APPROVALS_TOOLS
      : names.length === 3 && names.every((n) => /^[A-Za-z0-9._-]{1,128}$/.test(n))
        ? { request: names[0] as string, await: names[1] as string, cancel: names[2] as string }
        : ((): never => {
            throw new Error(`MCP_APPROVALS_TOOLS "${env["MCP_APPROVALS_TOOLS"] ?? ""}" is not <request>,<await>,<cancel>: three tool names`);
          })();
  const requesterMeta = env["MCP_APPROVALS_REQUESTER_META"]?.trim();
  if (requesterMeta !== undefined && requesterMeta !== "" && !/^[A-Za-z0-9._/-]{1,128}$/.test(requesterMeta)) {
    throw new Error(`MCP_APPROVALS_REQUESTER_META "${requesterMeta}" is not a _meta key`);
  }
  return { url, tokenFile, timeoutSec, tools, ...(requesterMeta ? { requesterMeta } : {}) };
};

/** The startup line's words: where questions go, never the token. */
export const describeApprovals = (settings: ApprovalsSettings): string => `approved by a person through ${settings.url.origin} (${settings.timeoutSec} s to answer)`;

type Seen = { readonly id?: string; readonly status?: string; readonly error?: string };

/** The JSON text a tool answered with, read for the fields the protocol names. */
const seen = (result: unknown): Seen => {
  const r = result as { readonly isError?: unknown; readonly content?: readonly { readonly type?: unknown; readonly text?: unknown }[] } | undefined;
  const text = r?.content?.find((c) => c.type === "text")?.text;
  if (typeof text !== "string") return { error: "the approval service answered without text" };
  const value = ((): unknown => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  })() as { readonly id?: unknown; readonly status?: unknown; readonly error?: { readonly kind?: unknown; readonly message?: unknown } } | undefined;
  if (typeof value !== "object" || value === null) return { error: `the approval service answered ${r?.isError === true ? "an error" : "text that is not JSON"}: ${text.slice(0, 200)}` };
  if (value.error !== undefined || r?.isError === true) {
    const kind = typeof value.error?.kind === "string" ? value.error.kind : "error";
    const message = typeof value.error?.message === "string" ? `: ${value.error.message}` : "";
    return { error: `the approval service refused the question (${kind}${message})` };
  }
  return { ...(typeof value.id === "string" ? { id: value.id } : {}), ...(typeof value.status === "string" ? { status: value.status } : {}) };
};

const settled = (status: string): Verdict =>
  YES.includes(status) ? { kind: "approved" } : { kind: "refused", message: `the person's answer through the approval service: ${status}` };

/** The requester record a service shows beside the question: what this server says about the call, no more. */
const requesterOf = (ask: ApprovalAsk): Record<string, unknown> => ({
  client: ask.service,
  session: ask.client.slice(0, 200),
  title: `${ask.service} ${ask.tool}`.slice(0, 120),
  host: hostname().slice(0, 100),
  extra: { session_url_unavailable: "a call to an MCP server, which has no page of its own", tool: ask.tool.slice(0, 200), caller: ask.client.slice(0, 200), args_sha256: ask.argsDigest },
});

/**
 * Ask a person, and wait for their answer. `signal` is the call's own: when
 * the client cancels or goes away, the question is withdrawn and the call is
 * refused. `progress` hears that the call is waiting, so a client that resets
 * its timeout on progress keeps waiting too.
 */
export const askApproval = async (settings: ApprovalsSettings, ask: ApprovalAsk, signal?: AbortSignal, progress?: Progress, now: () => number = Date.now): Promise<Verdict> => {
  const held = open.get(ask.client) ?? 0;
  if (held >= MAX_OPEN_PER_CLIENT) {
    return { kind: "unavailable", message: `this client has ${held} calls waiting for a person's answer already; wait for those before asking again` };
  }
  open.set(ask.client, held + 1);
  try {
    return await asked(settings, ask, signal, progress, now);
  } finally {
    const left = (open.get(ask.client) ?? 1) - 1;
    if (left > 0) open.set(ask.client, left);
    else open.delete(ask.client);
  }
};

const asked = async (settings: ApprovalsSettings, ask: ApprovalAsk, signal: AbortSignal | undefined, progress: Progress | undefined, now: () => number): Promise<Verdict> => {
  const token = await readFile(settings.tokenFile, "utf8").then(
    (t) => t.trim(),
    (cause: unknown) => new Error(`MCP_APPROVALS_TOKEN_FILE cannot be read (${(cause as NodeJS.ErrnoException).code ?? "error"})`),
  );
  if (token instanceof Error) return { kind: "unavailable", message: token.message };
  if (token === "") return { kind: "unavailable", message: "MCP_APPROVALS_TOKEN_FILE is empty" };
  const client = new Client({ name: ask.service, version: "1" });
  const meta = settings.requesterMeta === undefined ? {} : { _meta: { [settings.requesterMeta]: requesterOf(ask) } };
  const call = (name: string, args: Record<string, unknown>, timeoutMs: number) =>
    client.callTool({ name, arguments: args, ...meta }, { timeout: timeoutMs, ...(signal === undefined ? {} : { signal }) });
  const started = now();
  const deadline = started + settings.timeoutSec * 1000;
  let id: string | undefined;
  try {
    await client.connect(new StreamableHTTPClientTransport(settings.url, { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
    const filed = seen(
      await call(
        settings.tools.request,
        { connector: "approve", title: `Approve: ${ask.line}`.slice(0, 200), params: { action: ask.line }, timeout_sec: settings.timeoutSec },
        CALL_TIMEOUT_MS,
      ),
    );
    if (filed.error !== undefined) return { kind: "unavailable", message: filed.error };
    if (filed.id === undefined) return { kind: "unavailable", message: "the approval service filed the question without an id" };
    id = filed.id;
    let status = filed.status ?? "pending";
    while (status === "pending") {
      const left = Math.ceil((deadline - now()) / 1000);
      if (left <= 0) return { kind: "refused", message: `nobody answered within ${settings.timeoutSec} s` };
      progress?.(Math.floor((now() - started) / 1000), settings.timeoutSec, "waiting for a person to approve this call");
      const step = Math.min(left, AWAIT_STEP_SEC);
      const round = now();
      const waited = seen(await call(settings.tools.await, { id, timeout_sec: step }, step * 1000 + CALL_TIMEOUT_MS));
      if (waited.error !== undefined) return { kind: "unavailable", message: waited.error };
      if (waited.id !== undefined && waited.id !== id) return { kind: "unavailable", message: "the approval service answered about another question" };
      status = waited.status ?? "pending";
      const spent = now() - round;
      if (status === "pending" && spent < AWAIT_MIN_MS) await pause(AWAIT_MIN_MS - spent, signal);
    }
    const verdict = settled(status);
    if (verdict.kind === "approved") id = undefined;
    return verdict;
  } catch (thrown: unknown) {
    if (signal?.aborted === true) return { kind: "refused", message: "the call was cancelled while it waited for an answer" };
    return { kind: "unavailable", message: `the approval service could not be asked (${thrown instanceof Error ? thrown.message : String(thrown)})`.slice(0, 300) };
  } finally {
    // A question still open (no answer in time, the call cancelled, the service's answer unreadable) is withdrawn, so nobody approves a call that will not run.
    if (id !== undefined) await client.callTool({ name: settings.tools.cancel, arguments: { id }, ...meta }, { timeout: CALL_TIMEOUT_MS }).catch(() => undefined);
    await client.close().catch(() => undefined);
  }
};
