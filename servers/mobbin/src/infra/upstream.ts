import { Client, type GrantSource, isSecureUrl, StreamableHTTPClientTransport } from "@foreverworks/mcp-kit";

import type { UpstreamPort, UpstreamResult } from "../app/ports.js";
import { asAppError, fail, notAuthorized } from "../domain/errors.js";
import type { ToolSpec } from "../domain/schema.js";

export type UpstreamOptions = {
  readonly url: string;
  readonly access: GrantSource;
  readonly fetch?: typeof fetch;
  readonly listTimeoutMs?: number;
  /** Mobbin's "deep" search runs a model; give a call room. */
  readonly callTimeoutMs?: number;
};

const short = (thrown: unknown): string => (thrown instanceof Error ? thrown.message : String(thrown)).slice(0, 300);

/** Mobbin's MCP server over Streamable HTTP, with the bearer token the grant gives: one connection per task, closed after it. */
export const makeUpstream = ({ url, access, fetch: fetchImpl, listTimeoutMs = 30_000, callTimeoutMs = 120_000 }: UpstreamOptions): UpstreamPort => {
  const using = async <T>(task: (client: Client) => Promise<T>): Promise<T> => {
    if (!isSecureUrl(url)) fail({ kind: "discovery", message: `${url} is not an https address` });
    // The grant's own failure (none, or refused) reaches the caller as itself, before anything is sent.
    await access.get();
    const state: { refused?: unknown } = {};
    const transport = new StreamableHTTPClientTransport(new URL(url), {
      authProvider: {
        token: () => access.get(),
        // The token was refused before its stated expiry: refresh once; the transport retries the request.
        onUnauthorized: async () => {
          try {
            await access.force();
          } catch (thrown) {
            state.refused = thrown;
            throw thrown;
          }
        },
      },
      ...(fetchImpl === undefined ? {} : { fetch: fetchImpl }),
    });
    const client = new Client({ name: "mcp-bridge-for-mobbin", version: "1" });
    try {
      await client.connect(transport);
      return await task(client);
    } catch (thrown) {
      if (state.refused !== undefined) throw state.refused;
      if (asAppError(thrown) !== undefined) throw thrown;
      const message = short(thrown);
      if (/\b401\b|unauthori[sz]ed/i.test(message)) return fail(notAuthorized("Mobbin refused the access token even after a refresh"));
      if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|timed? ?out|aborted/i.test(message)) return fail({ kind: "unreachable", message: `Mobbin could not be reached: ${message}` });
      return fail({ kind: "upstream", message });
    } finally {
      await client.close().catch(() => undefined);
    }
  };

  return {
    listTools: () =>
      using(async (client) => {
        const specs: ToolSpec[] = [];
        let cursor: string | undefined;
        for (let page = 0; page < 20; page++) {
          const listed = await client.listTools(cursor === undefined ? undefined : { cursor }, { timeout: listTimeoutMs });
          for (const t of listed.tools) {
            specs.push({ name: t.name, ...(t.title === undefined ? {} : { title: t.title }), ...(t.description === undefined ? {} : { description: t.description }), inputSchema: { ...(t.inputSchema as Record<string, unknown>) } });
          }
          cursor = listed.nextCursor;
          if (cursor === undefined) break;
        }
        return specs;
      }),
    callTool: (name, args) =>
      using(async (client) => {
        const result = (await client.callTool({ name, arguments: { ...args } }, { timeout: callTimeoutMs })) as UpstreamResult & { readonly _meta?: unknown };
        return {
          content: result.content,
          ...(result.structuredContent === undefined ? {} : { structuredContent: result.structuredContent }),
          ...(result.isError === true ? { isError: true as const } : {}),
        };
      }),
  };
};
