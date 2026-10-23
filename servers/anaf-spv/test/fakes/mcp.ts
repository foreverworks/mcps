/**
 * Fake upstream MCP servers, connected in memory: a mailbox (in the shape of
 * this repository's google server, or of an arbitrary mail server with one
 * search tool) and a vault. Every connection gets a fresh server over the same
 * state, as a real one would.
 */
import { InMemoryTransport, McpServer, type Transport } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Source, TransportFor } from "../../src/infra/upstream/mcp.js";
import { PASSWORD, USERNAME } from "./spv.js";

export type Mail = { readonly id: string; readonly at: number; readonly body: string };

/** A mailbox: the codes SPV sends, its "Documente noi SPV" alerts (HTML), and whatever else a test puts there. */
export const makeMailbox = (now: () => number) => {
  const mails: Mail[] = [];
  const alerts: Mail[] = [];
  let n = 0;
  return {
    mails,
    alerts,
    deliverCode: (code: string) => mails.push({ id: `m${++n}`, at: now(), body: `Cod de siguranta: ${code}, expira dupa 300 secunde.` }),
    deliver: (body: string) => mails.push({ id: `m${++n}`, at: now(), body }),
    /** An alert as SPV sends it, one line per document posted. */
    deliverAlert: (at: number, lines: readonly string[]) =>
      alerts.push({
        id: `a${++n}`,
        at,
        body: `<html><body><p>Ați primit următoarele documente în Spațiul Privat Virtual (SPV) ANAF:<br><br>${lines.map((l) => `- CIF 29901XXXXXXXX: ${l}`).join("<br>")}</p><hr><small>Mesaj automat.</small></body></html>\r\n`,
      }),
  };
};

export type Mailbox = ReturnType<typeof makeMailbox>;

const text = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value) }] });

/** Like servers/google: every code in ONE thread, whose summary shows the newest message's snippet. */
export const googleMailServer = (box: Mailbox, calls: string[]) => {
  const server = new McpServer({ name: "fake-google", version: "test" });
  server.registerTool(
    "search_threads",
    { inputSchema: { query: z.string().default(""), max_results: z.number().default(20), page_token: z.string().default(""), account: z.string().default("*") } },
    async (args) => {
      calls.push(`search_threads ${args.account}${args.query.includes("Documente noi SPV") ? ` ${args.query}` : ""}`);
      if (args.query.includes("Documente noi SPV")) {
        // Each alert its own thread, newest first, two to a page.
        const all = [...box.alerts].sort((a, b) => b.at - a.at);
        const first = Number(args.page_token || "0");
        const page = all.slice(first, first + Math.min(args.max_results, 2));
        const next = first + page.length < all.length ? { nextPageToken: String(first + page.length) } : {};
        return text({ threads: page.map((a) => ({ account: "personal", id: a.id, snippet: "Ați primit următoarele documente" })), accounts: [{ account: "personal", ...next }] });
      }
      const newest = box.mails[box.mails.length - 1];
      return text({ threads: newest === undefined ? [] : [{ account: "personal", id: "thread-1", snippet: newest.body, messageCount: box.mails.length }] });
    },
  );
  server.registerTool("get_thread", { inputSchema: { thread_id: z.string(), detail: z.string().default("text"), account: z.string().default("") } }, async (args) => {
    calls.push(`get_thread ${args.thread_id} ${args.account}`);
    const alert = box.alerts.find((a) => a.id === args.thread_id);
    if (alert !== undefined) return text({ id: alert.id, messages: [{ id: alert.id, internalDate: String(alert.at), body: alert.body, bodySource: "html" }] });
    return text({ id: args.thread_id, messages: box.mails.map((m) => ({ id: m.id, internalDate: String(m.at), body: m.body, snippet: m.body })) });
  });
  server.registerTool("send_message", { inputSchema: { to: z.string() } }, async () => text({ ok: true }));
  return server;
};

/** An arbitrary mail server: one search tool answering plain text, newest first. */
export const textMailServer = (box: Mailbox, calls: string[], options: { readonly tool?: string; readonly requiresFolder?: boolean } = {}) => {
  const server = new McpServer({ name: "fake-mail", version: "test" });
  const tool = options.tool ?? "search_emails";
  server.registerTool(
    tool,
    { inputSchema: { query: z.string(), folder: options.requiresFolder ? z.string() : z.string().optional(), maxResults: z.number().optional() } },
    async (args) => {
      calls.push(`${tool} ${JSON.stringify(args)}`);
      const lines = [...box.mails].reverse().map((m) => `ID: ${m.id}\nFrom: Autentificare.SpatiuPrivat@anaf.ro\nSubject: Cod de siguranta\n${m.body}`);
      return text(lines.length === 0 ? "No messages found." : lines.join("\n\n"));
    },
  );
  server.registerTool("read_email", { inputSchema: { messageId: z.string() } }, async () => text("not used"));
  return server;
};

/** Like servers/bitwarden: get_password answers the login's username and password as JSON. */
export const vaultServer = (calls: string[], item = "item-1") => {
  const server = new McpServer({ name: "fake-vault", version: "test" });
  server.registerTool("get_password", { inputSchema: { id: z.string(), previous: z.boolean().default(false) } }, async (args) => {
    calls.push(`get_password ${args.id}`);
    if (args.id !== item) return { ...text({ error: { kind: "not_found", message: "no such item" } }), isError: true };
    return text({ id: item, name: "pfinternet.anaf.ro", username: USERNAME, password: PASSWORD, urls: ["https://pfinternet.anaf.ro/my.policy"] });
  });
  return server;
};

/** A TransportFor that connects each source to a fresh fake, in memory. */
export const inMemory =
  (make: Readonly<Partial<Record<Source, () => McpServer>>>): TransportFor =>
  async (source) => {
    const factory = make[source];
    if (factory === undefined) throw new Error(`no fake ${source} server in this test`);
    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await factory().connect(serverSide as Transport);
    return clientSide as Transport;
  };
