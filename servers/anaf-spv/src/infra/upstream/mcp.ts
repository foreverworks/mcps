import { Client, StdioClientTransport, StreamableHTTPClientTransport, type Transport } from "@foreverworks/mcp-kit";

import { fail, upstreamError } from "../../domain/errors.js";

/**
 * This server as an MCP CLIENT of another one: the mailbox the code is read
 * from, the vault the password is read from. Any MCP server will do, over
 * Streamable HTTP with a bearer token or spawned over stdio; what it is asked
 * is decided by a driver (mail/, vault.ts), not here.
 *
 * A connection lives for one sign-in: opened, used for a minute at most,
 * closed. A sign-in happens a few times a day, so a lasting connection would
 * only be one more thing to go stale.
 */
export type Source = "mail" | "vault";

export type Endpoint =
  | { readonly kind: "http"; readonly url: string; readonly token: () => Promise<string | undefined> }
  | { readonly kind: "stdio"; readonly command: string; readonly args: readonly string[]; readonly env: Readonly<Record<string, string>> };

export type ToolInfo = {
  readonly name: string;
  readonly properties: readonly string[];
  readonly required: readonly string[];
  /** The properties typed as strings, which is where a query can go. */
  readonly stringProperties: readonly string[];
};

/** A tool's answer: its text, the same parsed as JSON when it is JSON (or the structured content), and whether it is a failure. */
export type Answer = { readonly text: string; readonly json: unknown; readonly isError: boolean };

export type Connection = {
  readonly tools: () => Promise<readonly ToolInfo[]>;
  readonly call: (name: string, args: Readonly<Record<string, unknown>>) => Promise<Answer>;
  readonly close: () => Promise<void>;
};

export type Connect = () => Promise<Connection>;

/** How a transport is made for an endpoint; tests pass an in-memory pair. */
export type TransportFor = (source: Source, endpoint: Endpoint) => Promise<Transport>;

// The cast is the SDK's own gap (see packages/mcp-kit/src/smoke.ts): its HTTP transport does not
// satisfy its Transport type under exactOptionalPropertyTypes.
export const defaultTransport: TransportFor = async (_source, endpoint) => {
  if (endpoint.kind === "stdio") return new StdioClientTransport({ command: endpoint.command, args: [...endpoint.args], env: { ...endpoint.env }, stderr: "ignore" });
  const token = await endpoint.token();
  return new StreamableHTTPClientTransport(new URL(endpoint.url), token === undefined ? {} : { requestInit: { headers: { authorization: `Bearer ${token}` } } }) as Transport;
};

const CALL_TIMEOUT_MS = 30_000;

const describe = (endpoint: Endpoint): string => (endpoint.kind === "http" ? endpoint.url : endpoint.command);

const reason = (thrown: unknown): string => (thrown instanceof Error ? thrown.message : String(thrown)).slice(0, 300);

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .filter((c): c is { type: "text"; text: string } => typeof c === "object" && c !== null && (c as { type?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string")
        .map((c) => c.text)
        .join("\n")
    : "";

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const schemaOf = (tool: { readonly name: string; readonly inputSchema?: { readonly properties?: unknown; readonly required?: unknown } }): ToolInfo => {
  const properties = (tool.inputSchema?.properties ?? {}) as Readonly<Record<string, { readonly type?: unknown }>>;
  return {
    name: tool.name,
    properties: Object.keys(properties),
    required: Array.isArray(tool.inputSchema?.required) ? tool.inputSchema.required.filter((r): r is string => typeof r === "string") : [],
    stringProperties: Object.entries(properties)
      .filter(([, p]) => p.type === "string" || (Array.isArray(p.type) && p.type.includes("string")))
      .map(([name]) => name),
  };
};

export const makeConnect =
  (source: Source, endpoint: Endpoint, transportFor: TransportFor = defaultTransport): Connect =>
  async () => {
    const client = new Client({ name: "mcp-anaf-spv", version: "1.0.0" });
    try {
      await client.connect(await transportFor(source, endpoint));
    } catch (thrown) {
      await client.close().catch(() => undefined);
      fail(upstreamError(source, `could not connect to the ${source} MCP server at ${describe(endpoint)}: ${reason(thrown)}`));
    }
    let tools: readonly ToolInfo[] | undefined;
    return {
      tools: async () => {
        if (tools === undefined) {
          const listed = await client.listTools(undefined, { timeout: CALL_TIMEOUT_MS }).catch((thrown: unknown) => fail(upstreamError(source, `tools/list failed: ${reason(thrown)}`)));
          tools = listed.tools.map(schemaOf);
        }
        return tools;
      },
      call: async (name, args) => {
        const result = await client
          .callTool({ name, arguments: { ...args } }, { timeout: CALL_TIMEOUT_MS })
          .catch((thrown: unknown) => fail(upstreamError(source, `${name} failed: ${reason(thrown)}`)));
        const text = textOf(result.content);
        const structured = (result as { structuredContent?: unknown }).structuredContent;
        return { text, json: structured ?? parsed(text), isError: result.isError === true };
      },
      close: () => client.close().catch(() => undefined),
    };
  };

/** Open, use, close, whatever happens in between. */
export const using = async <T>(connect: Connect, fn: (connection: Connection) => Promise<T>): Promise<T> => {
  const connection = await connect();
  try {
    return await fn(connection);
  } finally {
    await connection.close();
  }
};

/** A tool's answer that must not be a failure: its failure text becomes this server's upstream failure. */
export const succeeded = (source: Source, tool: string, answer: Answer): Answer =>
  answer.isError ? fail(upstreamError(source, `${tool} answered an error: ${answer.text.slice(0, 300)}`)) : answer;

/**
 * A JSON template with `{{name}}` placeholders, filled: every string in it
 * has each placeholder replaced; a string that is exactly one placeholder
 * takes the value's own type.
 */
export const fillTemplate = (template: unknown, values: Readonly<Record<string, string>>): unknown => {
  if (typeof template === "string") {
    const whole = /^\{\{(\w+)\}\}$/.exec(template);
    if (whole?.[1] !== undefined && values[whole[1]] !== undefined) return values[whole[1]];
    return template.replace(/\{\{(\w+)\}\}/g, (all, key: string) => values[key] ?? all);
  }
  if (Array.isArray(template)) return template.map((item) => fillTemplate(item, values));
  if (typeof template === "object" && template !== null) return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, fillTemplate(v, values)]));
  return template;
};

/** A value at a dot path (`password`, `data.login.password`); `.` is the whole value. */
export const atPath = (value: unknown, path: string): unknown => {
  if (path === ".") return value;
  return path.split(".").reduce<unknown>((v, key) => (typeof v === "object" && v !== null ? (v as Record<string, unknown>)[key] : undefined), value);
};
