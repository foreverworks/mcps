import { fileURLToPath } from "node:url";

import type { McpServer } from "@modelcontextprotocol/server";

/**
 * The folders a stdio client shares with the server it spawned: MCP "roots",
 * which a client such as Claude Code declares for its workspace. A stdio
 * process serves exactly one client, so the process holds them: `serve` asks
 * the client once connected (and again when it says they changed), and the
 * input-file reader takes a path from them (inputFile.ts). Over HTTP there is
 * no such thing: a remote client's folders are on its own machine.
 *
 * Only a 2025-11-25 client is asked. Protocol 2026-07-28 deprecated roots and
 * dropped both the request and the change notice (a server can ask only as
 * part of one call's result), so for a client of that revision the folders a
 * deployment names (MCP_FILE_ROOTS) or the working directory decide, as for a
 * client that shares none.
 */
type Source = () => Promise<readonly string[]>;

const shared: { source: Source | undefined } = { source: undefined };

/** Set by `serve` over stdio; `undefined` forgets (tests). */
export const shareClientRoots = (source: Source | undefined): void => {
  shared.source = source;
};

/** The client's folders, or none: no stdio client, a client without roots, or one that did not answer. */
export const clientRoots = (): Promise<readonly string[]> => shared.source?.() ?? Promise.resolve([]);

/** The local folders among a client's root URIs; anything but file: is not a folder this server can read. */
export const pathsOfRoots = (uris: readonly string[]): readonly string[] =>
  uris.flatMap((uri) => {
    if (!uri.startsWith("file:")) return [];
    try {
      return [fileURLToPath(uri)];
    } catch {
      return [];
    }
  });

/**
 * Ask a connected client for its roots, once, and again after it announces a
 * change. A client that declared no roots capability is not asked; one that
 * fails to answer shares none, and is asked again on the next call.
 */
export const shareRootsOf = (server: McpServer, timeoutMs = 5000): void => {
  const cache: { roots: Promise<readonly string[]> | undefined } = { roots: undefined };
  server.server.setNotificationHandler("notifications/roots/list_changed", async () => {
    cache.roots = undefined;
  });
  const ask = async (): Promise<readonly string[]> => {
    if (server.server.getClientCapabilities()?.roots === undefined) return [];
    try {
      const { roots } = await server.server.listRoots(undefined, { timeout: timeoutMs });
      return pathsOfRoots(roots.map((root) => root.uri));
    } catch {
      cache.roots = undefined;
      return [];
    }
  };
  shareClientRoots(() => (cache.roots ??= ask()));
};
