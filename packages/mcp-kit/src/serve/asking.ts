import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createRequestStateCodec, inputResponse, type McpServer } from "@modelcontextprotocol/server";

import type { LinkForPerson } from "../call.js";
import { failGuard } from "../guardErrors.js";

/**
 * What the guard asks the person at the client in the middle of a call (a
 * money confirmation, a link to open), in the one shape both protocol
 * generations share: the call answers `input_required` with the question and
 * a `requestState`, and the client calls again with the person's answer and
 * that state. In 2026-07-28 the client does the retry; on a 2025 connection
 * over stdio the SDK turns the question into the server-to-client request
 * that revision has and calls again itself, so one code path serves both.
 *
 * The state travels through the client, so it is signed (HMAC, a key made
 * when the process starts, ten minutes to live), bound to the tool and to the
 * client the token names, spent the first time it comes back, and it holds a
 * digest of the exact arguments the person confirmed: a retry that changes
 * them, or replays an answer, is refused. The SDK's codec signs; it does not
 * hide, so the state holds nothing the client may not read. A restart forgets
 * the key, and a question asked before it must be asked again.
 */

/** How long a person has to answer a question asked in a call. */
export const ASK_TTL_SECONDS = 10 * 60;

/** What was asked, carried by the state to the call that brings the answer. */
export type Asked =
  | { readonly kind: "confirm"; readonly tool: string; readonly client: string; readonly nonce: string; readonly args: string }
  | {
      readonly kind: "link";
      readonly tool: string;
      readonly client: string;
      readonly nonce: string;
      readonly link: LinkForPerson;
      /** The call's result, sent with the person's answer once it comes; the call does not run again. */
      readonly result: unknown;
      readonly confirmed?: string;
    };

const codec = createRequestStateCodec<Asked>({ key: randomBytes(32), ttlSeconds: ASK_TTL_SECONDS });

/** States spent, until they would have expired anyway. */
const spent = new Map<string, number>();

const spend = (nonce: string, now: number): boolean => {
  for (const [n, until] of spent) if (until < now) spent.delete(n);
  if (spent.has(nonce)) return false;
  spent.set(nonce, now + ASK_TTL_SECONDS * 1000);
  return true;
};

type Unspent<T> = T extends unknown ? Omit<T, "nonce"> : never;

/** The state for a question: signed, and spent by the one call that answers it. */
export const stateFor = (asked: Unspent<Asked>): Promise<string> => codec.mint({ ...asked, nonce: randomUUID() } as Asked);

type Ctx = {
  readonly mcpReq?: {
    readonly inputResponses?: Record<string, unknown>;
    readonly requestState?: () => unknown;
    readonly envelope?: Readonly<Record<string, unknown>>;
  };
};

/**
 * The question this call answers, or none for a call that answers none. A
 * state that does not verify, belongs to another tool or client, or was spent
 * already, fails the call: the person is asked again by calling again.
 */
export const answering = async (ctx: unknown, tool: string, client: string, now: number = Date.now()): Promise<Asked | undefined> => {
  const raw = (ctx as Ctx | undefined)?.mcpReq?.requestState?.();
  if (raw === undefined || raw === null || raw === "") return undefined;
  const invalid = (why: string) => failGuard({ kind: "confirmation_invalid", message: `the answer this call carries ${why}` });
  if (typeof raw !== "string") return invalid("has a state this server did not make");
  const asked = await codec.verify(raw, ctx as never).catch((reason: unknown) => invalid(`has a state that ${String(reason instanceof Error ? reason.message : reason) === "expired" ? "expired" : "this server did not make"}`));
  if (asked.tool !== tool || asked.client !== client) return invalid("answers a question asked in another call");
  if (!spend(asked.nonce, now)) return invalid("was used already");
  return asked;
};

/** The person's answer to the question under `key`, as the client sent it back. */
export const answerTo = (ctx: unknown, key: string) => inputResponse((ctx as Ctx | undefined)?.mcpReq?.inputResponses, key);

/** The capabilities the client declared: per request in 2026-07-28, at initialize before it. */
export const clientCapabilities = (server: McpServer, ctx: unknown): { readonly elicitation?: { readonly form?: unknown; readonly url?: unknown } } | undefined => {
  const envelope = (ctx as Ctx | undefined)?.mcpReq?.envelope;
  const declared = envelope?.["io.modelcontextprotocol/clientCapabilities"];
  if (declared !== undefined) return declared as { readonly elicitation?: { readonly form?: unknown; readonly url?: unknown } };
  return server.server.getClientCapabilities() as { readonly elicitation?: { readonly form?: unknown; readonly url?: unknown } } | undefined;
};

/** Whether the client can show a form (a bare `elicitation: {}` means form) or open a link. */
export const canShowForm = (caps: ReturnType<typeof clientCapabilities>): boolean =>
  caps?.elicitation !== undefined && (caps.elicitation.form !== undefined || caps.elicitation.url === undefined);
export const canOpenLink = (caps: ReturnType<typeof clientCapabilities>): boolean => caps?.elicitation?.url !== undefined;

/**
 * The arguments a person confirmed, as one digest: keys in order, bytes by
 * their SHA-256, so a retry that sends the same call in another key order
 * matches and one that changes anything does not.
 */
export const digestOf = (value: unknown): string => createHash("sha256").update(canonical(value)).digest("hex");

const canonical = (value: unknown): string => {
  if (value instanceof Uint8Array) return JSON.stringify({ sha256: createHash("sha256").update(value).digest("hex") });
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};
