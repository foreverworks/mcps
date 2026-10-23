import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";

import { type Icon, inputRequired, type McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import { inCall, type LinkForPerson, type Progress, progressSender } from "../call.js";
import { failGuard } from "../guardErrors.js";
import { asFailure, failure, outcomeOf } from "../envelope.js";
import { type Access, type ConfirmedRule, isIdempotent, needsPerson, type ToolArgs, type ToolPolicy, type ToolRule } from "../policy.js";
import { DEFAULT_SETTINGS, type GuardSettings, within } from "./confirm.js";
import { answering, answerTo, canOpenLink, canShowForm, clientCapabilities, digestOf, stateFor } from "./asking.js";
import { answeredResult } from "./link.js";

/**
 * Every tool call passes through here, on every transport: the policy says what
 * the tool may do, the client is told so in the tool's annotations, a tool above
 * the server's ceiling refuses, a `money` call is confirmed with the user where
 * the deployment asks for it (and a write marked `confirm` the same way), and
 * each call leaves ONE audit line in the log.
 *
 * It wraps `registerTool` on the server a `register` function is handed, so a
 * server's own code does not change and cannot opt out.
 */

/** Who is calling: the client label of the bearer token, set by the HTTP layer. */
export const requestContext = new AsyncLocalStorage<{ readonly client: string }>();

export type AuditLine = {
  readonly svc: string;
  readonly tool: string;
  readonly client: string;
  readonly account: string | null;
  readonly access: Access;
  readonly outcome: string;
  readonly ms: number;
  /** `elicit` when the server confirmed the call with the user itself. */
  readonly confirmed?: string;
  /** For a call that handed a person a link (serve/link.ts): their answer, or `unsupported` or `failed` when nobody was asked. */
  readonly link?: string;
  /** For a call that answered with a question for the person (`outcome: "asked"`): what it asked, `confirm` or `link`. */
  readonly asked?: string;
};

/**
 * No arguments, no results, no bodies, no tokens: which tool, for whom, what
 * kind of effect, how it ended, how long it took. The `account` argument is
 * the one argument logged, because it is a label, and it is what an operator
 * reading the log needs to know ("was that the personal mailbox?").
 */
export const auditText = (line: AuditLine): string => `audit ${JSON.stringify(line)}`;

const accountOf = (args: ToolArgs): string | null => {
  const account = args["account"] ?? args["accounts"];
  if (typeof account === "string") return account;
  if (Array.isArray(account) && account.every((a) => typeof a === "string")) return account.join(",");
  return null;
};

/**
 * The MCP tool annotations the policy implies, so a client can tell a read from
 * a write from a payment without anyone declaring it twice: clients use
 * `readOnlyHint` to skip a confirmation and ask before a `destructiveHint` tool,
 * and may retry an `idempotentHint` tool after a dropped answer.
 *
 * The policy wins over a tool's own hints where they disagree: a vendor tool
 * that calls itself read-only but spends money is `money` here, and a write is
 * idempotent only when its policy line says so (a test proves each), whatever
 * a vendor claims. A write's `destructiveHint` is left to the tool, since the
 * spec's default (true) is the safe reading for a write nobody described.
 * `openWorldHint` is true unless the tool says otherwise: every tool here
 * reaches a service outside the server, and a tool that does not knows it.
 */
export const annotationsFor = (rule: ToolRule, own: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> => ({
  openWorldHint: true,
  ...own,
  readOnlyHint: rule.access === "read",
  ...(rule.access === "money" ? { destructiveHint: true } : {}),
  idempotentHint: isIdempotent(rule),
});

/**
 * `tools/list` in name order, whatever order a server registers in. The
 * 2026-07-28 revision asks for a deterministic order, so a client can cache the
 * list and a model's prompt cache keeps hitting; name order holds through any
 * refactor of a server's registration and through a vendor's new release.
 * The SDK lists tools in the order its map holds them, so the map is rebuilt
 * in place (the registered tools' own handles keep pointing at it). A missing
 * map means the SDK changed under the guard: a startup failure, not a guess.
 */
const inNameOrder = (server: McpServer): void => {
  const tools = (server as unknown as { readonly _registeredTools?: Record<string, unknown> })._registeredTools;
  if (typeof tools !== "object" || tools === null) throw new Error("the MCP SDK no longer keeps _registeredTools: the guard cannot order tools/list");
  const names = Object.keys(tools);
  const sorted = [...names].sort();
  if (names.every((name, i) => name === sorted[i])) return;
  const entries = sorted.map((name) => [name, tools[name]] as const);
  for (const name of names) Reflect.deleteProperty(tools, name);
  for (const [name, tool] of entries) tools[name] = tool;
};

/**
 * Where a tool's access class travels in `tools/list`, under the tool's `_meta`
 * (a reverse-DNS key, as the spec asks of names it does not define), so a
 * client, a gateway or the docs check can read the policy itself rather than
 * guess it from the hints. A client's permission rules can be generated from it.
 */
export const ACCESS_META = "foreverworks.com/access";

/**
 * Claude Code's mark for a tool whose every call a person must approve: it
 * prompts whatever the permission mode or allow rules, offers no "don't ask
 * again", and denies where no person can answer
 * (code.claude.com/docs/en/mcp, "Require approval for a specific tool").
 * Other clients ignore a `_meta` key they do not know.
 */
export const REQUIRES_USER_META = "anthropic/requiresUserInteraction";

/** The tool's `_meta`: its own, the access class, and the client's confirmation mark on a tool that needs a person. */
const metaFor = (rule: ToolRule, settings: GuardSettings, own: Readonly<Record<string, unknown>> | undefined): Readonly<Record<string, unknown>> => ({
  ...own,
  [ACCESS_META]: rule.access,
  ...(needsPerson(rule) && settings.confirm === "client" ? { [REQUIRES_USER_META]: true } : {}),
});

/** What a tool's description ends with, by what this deployment does with it. */
const noteFor = (rule: ToolRule, settings: GuardSettings): string => {
  if (!within(rule.access, settings.maxAccess)) return ` Disabled on this server, which runs ${settings.maxAccess} tools at most.`;
  if (!needsPerson(rule)) return "";
  const what = rule.access === "money" ? "Moves money or makes a legal document" : "Acts outside the computer";
  switch (settings.confirm) {
    case "elicit":
      return ` ${what}: the server asks the user to confirm each call before it runs.`;
    case "client":
      return ` ${what}: the client asks the user to approve each call.`;
    case "none":
      return ` ${what}: confirm with the user before each call.`;
  }
};

/** What the person at the client sees: the line, and one box to tick. */
const PROMPT_SCHEMA = {
  type: "object" as const,
  properties: { confirm: { type: "boolean" as const, title: "Confirm", description: "Run exactly this, once" } },
  required: ["confirm"],
};

type RawShape = Readonly<Record<string, unknown>>;
type ToolConfig = {
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly description?: string;
  readonly annotations?: Readonly<Record<string, unknown>>;
  readonly _meta?: Readonly<Record<string, unknown>>;
} & Readonly<Record<string, unknown>>;
type Callback = (...args: readonly unknown[]) => unknown;

const isZod4 = (value: unknown): boolean => typeof value === "object" && value !== null && "_zod" in value;

/** The strict output schema as a parser, when it is one zod can run; a schema of another kind is left to the SDK. */
const outputParser = (schema: unknown): SafeParser | undefined => (isZod4(schema) ? (schema as SafeParser) : undefined);

/**
 * An argument the tool does not name is refused, not dropped. zod strips an
 * unknown key by default, so `list_invoices({ days: 3 })` against a schema that
 * says `zile` would run on the default window and say nothing. Strict, the
 * call fails naming the key, and the JSON Schema a client sees says
 * `additionalProperties: false`. A schema that is not zod 4
 * is left as it came: mixing versions in one object is what the SDK refuses.
 * An output schema is made strict the same way, so a result that grows a field
 * its schema does not name fails in a test rather than reaching a client
 * undescribed (nested objects are strict where the schema says z.strictObject).
 */
const strictInput = (schema: unknown): unknown => {
  if (schema === undefined) return undefined;
  if (isZod4(schema)) {
    const asObject = schema as { strict?: () => unknown };
    return typeof asObject.strict === "function" ? asObject.strict() : schema;
  }
  const shape = schema as RawShape;
  return Object.values(shape).every(isZod4) ? z.strictObject(shape as Record<string, z.ZodType>) : schema;
};

export type GuardOptions = {
  readonly service: string;
  readonly policy: ToolPolicy;
  /** The ceiling and who confirms money calls; everything enabled and the client confirming, by default. */
  readonly settings?: GuardSettings;
  readonly log: (line: string) => void;
  /**
   * The server's own failures, for what fails before a tool's envelope can
   * catch it: a money rule's `resolve` (a lookup that finds nothing, an
   * argument the server refuses). Without it such a failure is `unexpected`.
   */
  readonly vocabulary?: ServerVocabulary;
  /**
   * Whether a question can reach the person at the client in the middle of a
   * call (serve/asking.ts): over stdio in both protocol generations, over HTTP
   * in 2026-07-28 only. It decides whether a money call can be confirmed by
   * elicitation and whether a link a call hands a person is offered by the
   * client (serve/link.ts). True unless the transport says otherwise.
   */
  readonly midCall?: boolean;
  /** Each tool's icons in tools/list, by tool name (a product's icon on its tools: serve/icons.ts). */
  readonly icons?: ReadonlyMap<string, readonly Icon[]>;
};

/**
 * A server's `EnvelopeVocabulary`, whatever its error type. Method syntax on
 * purpose: its parameters are checked both ways, so `remedyFor(error: AppError)`
 * fits, as it must for every server to pass its own.
 */
export type ServerVocabulary = {
  asAppError(thrown: unknown): object | undefined;
  remedyFor(error: object): string;
};

const UNKNOWN_VOCABULARY: ServerVocabulary = { asAppError: () => undefined, remedyFor: () => "" };

const run = async (cb: Callback, hadSchema: boolean, args: ToolArgs, extra: unknown): Promise<unknown> =>
  hadSchema ? cb(args, extra) : cb(extra);

type SafeParser = { readonly safeParse: (value: unknown) => { readonly success: true } | { readonly success: false; readonly error: z.core.$ZodError } };

/**
 * A tool with an output schema (MCP structured content): the JSON its text
 * block carries, checked against the schema and sent beside it as
 * `structuredContent`, so a client gets typed data and the text stays for
 * clients that read text. What is checked is what the client will parse, the
 * text itself. A result that does not match is a bug in this server, answered
 * as `unexpected` in the usual failure shape; a failure passes as it is, with
 * no structured content, as the spec has it.
 *
 * Measured 2026-10-22 (scripts/measure-tokens.ts, GPT-4 tokenizer): an output
 * schema adds about as much to a tool's definition as the rest of it (bnr's
 * three tools 635 -> 1,320 tokens, trademarks' three 927 -> 2,288, eas's seven
 * lists +1,636). Claude Code shows the model neither the schema nor, when
 * structured content is present, the text block (it passes the structured
 * content in its place), so there it costs nothing; a client that forwards
 * schemas and both blocks pays the definition and each result twice. Hence
 * opt-in, per tool, for results that are small and that a program acts on.
 */
const structured = (name: string, output: SafeParser, result: unknown): unknown => {
  const sent = result as { readonly isError?: unknown; readonly content?: readonly { readonly type?: unknown; readonly text?: unknown }[] } | undefined;
  if (sent?.isError === true) return result;
  const text = sent?.content?.[0]?.type === "text" ? sent.content[0].text : undefined;
  const value = ((): unknown => {
    try {
      return typeof text === "string" ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      return undefined;
    }
  })();
  const unexpected = (message: string) => failure({ kind: "unexpected", message } as { kind: string }, "report this; it is a bug");
  if (value === undefined) return unexpected(`${name} has an output schema and answered without the JSON text the envelope writes`);
  const checked = output.safeParse(value);
  if (!checked.success) return unexpected(`${name}'s result does not match its output schema: ${z.prettifyError(checked.error).replace(/\s+/g, " ")}`);
  return { ...(result as object), structuredContent: value };
};

type Ran = {
  readonly result: unknown;
  readonly confirmed?: string;
  readonly link?: string;
  /** Set when the call answered with a question for the person instead of a result (serve/asking.ts). */
  readonly asked?: "confirm" | "link";
};

type Notify = Parameters<typeof progressSender>[1];

/**
 * The call this request is, for the code a tool runs (call.ts): the request's
 * abort signal, which the SDK fires on a client's cancellation or a closed
 * connection, and a progress reporter when the client sent a progressToken.
 */
const callOf = (ctx: unknown): { readonly signal: AbortSignal | undefined; readonly progress: Progress | undefined } => {
  const request = (ctx as { readonly mcpReq?: { readonly signal?: AbortSignal; readonly _meta?: { readonly progressToken?: string | number }; readonly notify?: Notify } } | undefined)
    ?.mcpReq;
  const token = request?._meta?.progressToken;
  const send = request?.notify;
  return { signal: request?.signal, progress: token === undefined || send === undefined ? undefined : progressSender(token, send) };
};

/** Who is asking where: the tool, the client its token names, the server and the request. */
type Asking = { readonly server: McpServer; readonly ctx: unknown; readonly tool: string; readonly client: string; readonly midCall: boolean };

/**
 * A call a person confirms. What a path names is read once per round, here,
 * so the line and the call get the same arguments; the first round asks
 * (input_required, with a digest of the arguments in its state), and the
 * round that brings the answer runs the call only on a yes, and only on the
 * arguments that were confirmed.
 */
const runConfirmed = async (
  asking: Asking,
  rule: ConfirmedRule,
  options: GuardOptions & { readonly settings: GuardSettings },
  cb: Callback,
  hadSchema: boolean,
  args: ToolArgs,
  answered: Awaited<ReturnType<typeof answering>>,
): Promise<Ran> => {
  const resolved = rule.resolve === undefined ? args : await rule.resolve(args);
  if (options.settings.confirm !== "elicit") return { result: await run(cb, hadSchema, resolved, asking.ctx) };
  if (answered?.kind === "confirm") {
    if (answered.args !== digestOf(resolved)) {
      return failGuard({ kind: "confirmation_invalid", message: "the call came back with arguments other than the ones the user confirmed" });
    }
    const answer = answerTo(asking.ctx, "confirm");
    if (answer.kind === "elicit" && answer.action === "accept" && answer.content?.["confirm"] === true) {
      return { result: await run(cb, hadSchema, resolved, asking.ctx), confirmed: "elicit" };
    }
    return failGuard({ kind: "confirmation_denied", message: `the user answered ${answer.kind !== "elicit" ? "nothing" : answer.action === "accept" ? "no" : answer.action}` });
  }
  if (!asking.midCall || !canShowForm(clientCapabilities(asking.server, asking.ctx))) {
    return failGuard({
      kind: "confirmation_unavailable",
      message: asking.midCall
        ? "this server confirms this call with the user, and this client did not offer MCP elicitation"
        : "this server confirms this call with the user, and a client of protocol 2025-11-25 over HTTP cannot be asked anything mid-call",
    });
  }
  const line = `${options.service}: ${rule.summary(resolved)}`.replace(/[\r\n]+/g, " ").slice(0, 300);
  return {
    result: inputRequired({
      inputRequests: { confirm: inputRequired.elicit({ message: `Confirm? ${line}`, requestedSchema: PROMPT_SCHEMA }) },
      requestState: await stateFor({ kind: "confirm", tool: asking.tool, client: asking.client, args: digestOf(resolved) }),
    }),
    asked: "confirm",
  };
};

/**
 * A call that succeeded and handed a person a link: offered to them by a
 * client that can (serve/link.ts), as a question whose answer comes back with
 * the result in its state, so the call does not run again; as it came
 * everywhere else. A failed call offers nothing: whatever it began did not finish.
 */
const linkOffered = async (asking: Asking, link: LinkForPerson, ran: Ran): Promise<Ran> => {
  if (outcomeOf(ran.result) !== "ok") return ran;
  if (!asking.midCall || !canOpenLink(clientCapabilities(asking.server, asking.ctx))) return { ...ran, link: "unsupported" };
  return {
    ...ran,
    result: inputRequired({
      inputRequests: { link: inputRequired.elicitUrl({ message: link.message, url: link.url }) },
      requestState: await stateFor({
        kind: "link",
        tool: asking.tool,
        client: asking.client,
        link,
        result: ran.result,
        ...(ran.confirmed === undefined ? {} : { confirmed: ran.confirmed }),
      }),
    }),
    asked: "link",
  };
};

/** The round that brings the person's answer about a link: the result the call made, as they answered (serve/link.ts). */
const linkAnswered = (asking: Asking, answered: Extract<NonNullable<Awaited<ReturnType<typeof answering>>>, { kind: "link" }>): Ran => {
  const answer = answerTo(asking.ctx, "link");
  const confirmed = answered.confirmed === undefined ? {} : { confirmed: answered.confirmed };
  return answer.kind === "elicit"
    ? { result: answeredResult(answered.result, answered.link, answer.action), link: answer.action, ...confirmed }
    : { result: answered.result, link: "failed", ...confirmed };
};

const wrapCallback = (
  server: McpServer,
  name: string,
  rule: ToolRule,
  options: GuardOptions & { readonly settings: GuardSettings },
  cb: Callback,
  hadSchema: boolean,
  output: SafeParser | undefined,
): Callback =>
  async (...cbArgs: readonly unknown[]) => {
    const started = performance.now();
    const args = (hadSchema ? (cbArgs[0] ?? {}) : {}) as ToolArgs;
    const ctx = hadSchema ? cbArgs[1] : cbArgs[0];
    const { maxAccess, clientMaxAccess } = options.settings;
    const client = requestContext.getStore()?.client ?? "stdio";
    const clientCeiling = clientMaxAccess?.[client];
    const call = callOf(ctx);
    const asking: Asking = { server, ctx, tool: name, client, midCall: options.midCall !== false };
    const offered: { link?: LinkForPerson } = {};
    const outcome = await inCall({ ...call, offer: (link) => (offered.link = link) }, async (): Promise<Ran> => {
      if (!within(rule.access, maxAccess)) {
        return failGuard({ kind: "access_denied", access: rule.access, allowed: maxAccess, message: `${name} is ${rule.access}; this server runs ${maxAccess} tools at most` });
      }
      if (clientCeiling !== undefined && !within(rule.access, clientCeiling)) {
        return failGuard({
          kind: "access_denied",
          access: rule.access,
          allowed: clientCeiling,
          client,
          message: `${name} is ${rule.access}; client ${client} may run ${clientCeiling} tools at most here`,
        });
      }
      const answered = await answering(ctx, name, client);
      if (answered?.kind === "link") return linkAnswered(asking, answered);
      return needsPerson(rule) ? runConfirmed(asking, rule, options, cb, hadSchema, args, answered) : { result: await run(cb, hadSchema, args, ctx) };
    })
      .then((ran) => (offered.link === undefined || ran.asked !== undefined ? ran : linkOffered(asking, offered.link, ran)))
      .then((ran): Ran => (output === undefined || ran.asked !== undefined ? ran : { ...ran, result: structured(name, output, ran.result) }))
      .catch((thrown: unknown): Ran => ({ result: asFailure(thrown, options.vocabulary ?? UNKNOWN_VOCABULARY) }));
    options.log(
      auditText({
        svc: options.service,
        tool: name,
        client,
        account: accountOf(args),
        access: rule.access,
        outcome: outcome.asked === undefined ? outcomeOf(outcome.result) : "asked",
        ms: Math.round(performance.now() - started),
        ...(outcome.confirmed !== undefined ? { confirmed: outcome.confirmed } : {}),
        ...(outcome.link !== undefined ? { link: outcome.link } : {}),
        ...(outcome.asked !== undefined ? { asked: outcome.asked } : {}),
      }),
    );
    return outcome.result;
  };

/**
 * The server `register` is handed. Registering a tool the policy does not name
 * throws, which fails the process at startup (serve registers once before it
 * listens), never a call in flight.
 */
export const guard = (server: McpServer, options: GuardOptions): McpServer => {
  const settled = { ...options, settings: options.settings ?? DEFAULT_SETTINGS };
  return new Proxy(server, {
    get: (target, prop, receiver) => {
      if (prop !== "registerTool") return Reflect.get(target, prop, receiver) as unknown;
      return (name: string, config: ToolConfig, cb: Callback) => {
        const rule = settled.policy[name];
        if (rule === undefined) throw new Error(`${settled.service}: tool ${name} is not in the policy`);
        const outputSchema = strictInput(config.outputSchema);
        const guardedConfig = {
          ...config,
          annotations: annotationsFor(rule, config.annotations),
          _meta: metaFor(rule, settled.settings, config._meta),
          description: `${config.description ?? ""}${noteFor(rule, settled.settings)}`,
          inputSchema: strictInput(config.inputSchema),
          ...(settled.icons?.has(name) === true ? { icons: [...(settled.icons.get(name) ?? [])] } : {}),
          ...(outputSchema === undefined ? {} : { outputSchema }),
        };
        const registered = (target.registerTool as (n: string, c: unknown, f: Callback) => unknown)(
          name,
          guardedConfig,
          wrapCallback(target, name, rule, settled, cb, config.inputSchema !== undefined, outputParser(outputSchema)),
        );
        inNameOrder(target);
        return registered;
      };
    },
  });
};

/** Every tool a registration makes, by registering onto a recorder. */
export const registeredNames = (register: (server: McpServer) => void): readonly string[] => {
  const names: string[] = [];
  const recorder = new Proxy({} as McpServer, {
    get: (_target, prop) =>
      prop === "registerTool"
        ? (name: string) => {
            names.push(name);
            return { enable: () => {}, disable: () => {}, remove: () => {}, update: () => {} };
          }
        : () => undefined,
  });
  register(recorder);
  return names;
};
