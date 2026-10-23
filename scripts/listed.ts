/**
 * A built server as a client first sees it: started over stdio with an empty
 * environment and a temporary HOME, its tools/list and its instructions. Shared
 * by check-docs (which holds a README to it) and measure-tokens (which weighs
 * it), so both read exactly what a client is handed. `era` is the protocol
 * generation the client speaks: 2025-11-25 (`legacy`, the default) or
 * 2026-07-28 (`modern`); check-docs asks in both and holds them equal.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client, type Implementation, type ProtocolEra, StdioClientTransport, type Tool } from "@foreverworks/mcp-kit";

/** `home` is the temporary HOME the server ran with (gone by now), which a description may name. */
export type Listed = { readonly tools: readonly Tool[]; readonly instructions: string; readonly server?: Implementation; readonly home: string };

export const listServer = async (dir: string, era: ProtocolEra = "legacy"): Promise<Listed> => {
  const home = mkdtempSync(join(tmpdir(), "listed-"));
  const client = new Client({ name: "repository-check", version: "0" }, era === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : {});
  try {
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: ["dist/index.js"], cwd: dir, env: { PATH: process.env["PATH"] ?? "", HOME: home }, stderr: "pipe" }),
    );
    const { tools } = await client.listTools();
    const server = client.getServerVersion();
    return { tools, instructions: client.getInstructions() ?? "", home, ...(server === undefined ? {} : { server }) };
  } finally {
    await client.close().catch(() => undefined);
    rmSync(home, { recursive: true, force: true });
  }
};
