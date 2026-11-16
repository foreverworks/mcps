import { Client, type Implementation, StdioClientTransport, StreamableHTTPClientTransport, type Transport } from "./mcp.js";

/**
 * A server as an MCP CLIENT of another one: a vault it reads a password from,
 * a mailbox it reads a sign-in code from. Any MCP server will do, over
 * Streamable HTTP with a bearer token or spawned over stdio; what it is asked,
 * and how a failure reads to the server's caller, are the server's.
 *
 * A connection is opened for one task and closed after it (`usingUpstream`):
 * the servers here need one to sign in, which happens a few times a day at
 * most, so a lasting connection would only be one more thing to go stale.
 */
export type UpstreamEndpoint =
  | { readonly kind: "http"; readonly url: string; readonly token: () => Promise<string | undefined> }
  | { readonly kind: "stdio"; readonly command: string; readonly args: readonly string[]; readonly env: Readonly<Record<string, string>> };

export type UpstreamTool = {
  readonly name: string;
  readonly properties: readonly string[];
  readonly required: readonly string[];
  /** The properties typed as strings, which is where a query can go. */
  readonly stringProperties: readonly string[];
};

/** A tool's answer: its text, and the same parsed as JSON when it is JSON (or the structured content). */
export type UpstreamAnswer = { readonly text: string; readonly json: unknown };

export type UpstreamConnection = {
  /** The upstream's tools, listed once per connection. */
  readonly tools: () => Promise<readonly UpstreamTool[]>;
  /** A tool's answer; a tool that answers an error is a failure, with the start of its text. */
  readonly call: (name: string, args: Readonly<Record<string, unknown>>) => Promise<UpstreamAnswer>;
  readonly close: () => Promise<void>;
};

export type UpstreamConnect = () => Promise<UpstreamConnection>;

/** How a transport is made for an endpoint; tests pass an in-memory pair. */
export type UpstreamTransportFor = (endpoint: UpstreamEndpoint) => Promise<Transport>;

export type UpstreamOptions = {
  /** What the upstream is to this server ("vault", "mail"), as its failures name it. */
  readonly name: string;
  /** This server, as it introduces itself to the upstream. */
  readonly client: Implementation;
  /** The server's own failure for an upstream that cannot be reached or answers an error. */
  readonly fail: (message: string) => never;
  readonly transportFor?: UpstreamTransportFor;
  readonly timeoutMs?: number;
};

// The cast is the SDK's own gap (see smoke.ts): its HTTP transport does not satisfy its Transport
// type under exactOptionalPropertyTypes.
export const upstreamTransport: UpstreamTransportFor = async (endpoint) => {
  if (endpoint.kind === "stdio") return new StdioClientTransport({ command: endpoint.command, args: [...endpoint.args], env: { ...endpoint.env }, stderr: "ignore" });
  const token = await endpoint.token();
  return new StreamableHTTPClientTransport(new URL(endpoint.url), token === undefined ? {} : { requestInit: { headers: { authorization: `Bearer ${token}` } } }) as Transport;
};

const CALL_TIMEOUT_MS = 30_000;

const describe = (endpoint: UpstreamEndpoint): string => (endpoint.kind === "http" ? endpoint.url : endpoint.command);

/** What the SDK threw, shortened. Only the SDK's own errors reach here: the server's failures are thrown past it. */
const reason = (thrown: unknown): string => (thrown instanceof Error ? thrown.message : String(thrown)).slice(0, 300);

const textOf = (content: unknown): string =>
  Array.isArray(content)
    ? content
        .filter((c): c is { type: "text"; text: string } => typeof c === "object" && c !== null && (c as { type?: unknown }).type === "text" && typeof (c as { text?: unknown }).text === "string")
        .map((c) => c.text)
        .join("\n")
    : "";

const jsonOf = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const toolOf = (tool: { readonly name: string; readonly inputSchema?: { readonly properties?: unknown; readonly required?: unknown } }): UpstreamTool => {
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

/**
 * How to open a connection to one upstream. The transport is made before
 * connecting, so a failure of the server's own (a token file it cannot read)
 * reaches its caller as that, not as an upstream that could not be reached.
 */
export const connectUpstream =
  (endpoint: UpstreamEndpoint, { name, client: identity, fail, transportFor = upstreamTransport, timeoutMs = CALL_TIMEOUT_MS }: UpstreamOptions): UpstreamConnect =>
  async () => {
    const transport = await transportFor(endpoint);
    const client = new Client(identity);
    try {
      await client.connect(transport);
    } catch (thrown) {
      await client.close().catch(() => undefined);
      fail(`could not connect to the ${name} MCP server at ${describe(endpoint)}: ${reason(thrown)}`);
    }
    let tools: readonly UpstreamTool[] | undefined;
    return {
      tools: async () => {
        if (tools === undefined) {
          const listed = await client.listTools(undefined, { timeout: timeoutMs }).catch((thrown: unknown) => fail(`tools/list failed: ${reason(thrown)}`));
          tools = listed.tools.map(toolOf);
        }
        return tools;
      },
      call: async (tool, args) => {
        const result = await client.callTool({ name: tool, arguments: { ...args } }, { timeout: timeoutMs }).catch((thrown: unknown) => fail(`${tool} failed: ${reason(thrown)}`));
        const text = textOf(result.content);
        if (result.isError === true) return fail(`${tool} answered an error: ${text.slice(0, 300)}`);
        const structured = (result as { structuredContent?: unknown }).structuredContent;
        return { text, json: structured ?? jsonOf(text) };
      },
      close: () => client.close().catch(() => undefined),
    };
  };

/** Open, use, close, whatever happens in between. */
export const usingUpstream = async <T>(connect: UpstreamConnect, fn: (connection: UpstreamConnection) => Promise<T>): Promise<T> => {
  const connection = await connect();
  try {
    return await fn(connection);
  } finally {
    await connection.close();
  }
};

/**
 * A JSON template with `{{name}}` placeholders, filled: every string in it
 * has each placeholder replaced; a string that is exactly one placeholder
 * takes the value's own type. How a deployment says what a tool it chose
 * takes (`{"id": "{{item}}"}`) without this server knowing that tool.
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
