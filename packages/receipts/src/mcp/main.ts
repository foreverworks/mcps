import { guardEgress, type McpServer, type PackageIdentity, serve, type Served } from "@foreverworks/mcp-kit";

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
 * Build a receipts server's dependencies and serve them: stdio by default, or
 * HTTP when MCP_HTTP_PORT is set; `serve` in mcp-kit decides, and nothing here
 * knows which.
 *
 * The egress allowlist (MCP_EGRESS_ALLOW) goes in force first. `serve` would
 * install it too, but `buildDeps` runs before `serve`, and an API client that
 * takes the global `fetch` while it is built keeps the unguarded one for good:
 * its requests would never be checked against the list.
 */
export const startServer = async <D>(spec: ServerSpec<D>): Promise<Served> => {
  guardEgress(process.env);
  const deps = spec.buildDeps();
  const { name, version, title, websiteUrl, icons, instructions } = spec;
  return serve({
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

/**
 * A receipts server's main. Nothing is logged to stdout: over stdio it IS the
 * protocol channel, and a stray line there corrupts the session.
 *
 * One binary, two modes: `--health` shares the server's composition root, so
 * the check can never drift from what the server itself would do.
 */
export const runServer = <D>(spec: ServerSpec<D>): void => {
  const main = async (): Promise<void> => {
    // Before the health check too, so `--health` is judged by the list the server runs under:
    // a wrong MCP_EGRESS_ALLOW fails it, instead of failing every tool call later.
    guardEgress(process.env);
    if (process.argv.includes("--health")) process.exit(await spec.healthCheck());
    await startServer(spec);
  };
  main().catch((error: unknown) => {
    console.error(`${spec.name} failed to start:`, error);
    process.exit(1);
  });
};
