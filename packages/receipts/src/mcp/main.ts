import { type McpServer, type PackageIdentity, serve } from "@foreverworks/mcp-kit";

import { POLICY } from "./policy.js";

export type ServerSpec<D> = Partial<PackageIdentity> & {
  readonly name: string;
  readonly version: string;
  /** What the server tells a client at initialize: what it reads and which tool to start with, in the app's words. */
  readonly instructions: string;
  /** Built once per process, and only when serving: HTTP builds a fresh McpServer per request over these. */
  readonly buildDeps: () => D;
  readonly register: (server: McpServer, deps: D) => void;
  /** `--health`: the shell-callable check, its exit code the process's. */
  readonly healthCheck: () => Promise<number>;
};

/**
 * A receipts server's main. stdio by default, or HTTP when MCP_HTTP_PORT is
 * set; `serve` in mcp-kit decides, and nothing here knows which. Nothing is
 * logged to stdout: over stdio it IS the protocol channel, and a stray line
 * there corrupts the session.
 *
 * One binary, two modes: `--health` shares the server's composition root, so
 * the check can never drift from what the server itself would do.
 */
export const runServer = <D>(spec: ServerSpec<D>): void => {
  const main = async (): Promise<void> => {
    if (process.argv.includes("--health")) process.exit(await spec.healthCheck());
    const deps = spec.buildDeps();
    const { name, version, title, websiteUrl, icons, instructions } = spec;
    await serve({
      name,
      version,
      ...(title === undefined ? {} : { title }),
      ...(websiteUrl === undefined ? {} : { websiteUrl }),
      ...(icons === undefined ? {} : { icons }),
      instructions,
      policy: POLICY,
      register: (server) => spec.register(server, deps),
    });
  };
  main().catch((error: unknown) => {
    console.error(`${spec.name} failed to start:`, error);
    process.exit(1);
  });
};
