import type { BigIntStats } from "node:fs";
import { resolve } from "node:path";

import type { HandedBack } from "../handedBack.js";
import { isInside } from "../inputFile/roots.js";

/**
 * The outbox files each client held to a ceiling (MCP_CLIENT_MAX_ACCESS) may
 * fetch over HTTP: the ones its own calls handed back. The file endpoints
 * (serve/files.ts) refuse such a client everything else, because the ceiling
 * checks tool calls and a file crosses outside them. A file one of its calls
 * saved is the exception that grants nothing new: a tool within its ceiling
 * made it for this client, and the call's result already links it.
 *
 * What counts is what the call's own code handed back through the kit's
 * outbox writer (`noteHandedBack`, which the guard watches), never a
 * `resource_link` a result merely carries: a tool that echoes a link it was
 * given would otherwise open another client's file to a held one.
 *
 * Each record is the file as it was written (device, inode, size,
 * modification and change time, read from the written file itself, or from
 * the path the moment the write is noted), so a file put at the same path
 * later, by another client's call during this one or anything else, is not
 * the one recorded, and neither is a link put in its place. The change time
 * is part of it, so a later chmod, chgrp, ACL, relabel or hard link of the
 * file makes it unfetchable too: that fails closed. Records are kept in
 * memory, per client, at most `maxPerClient` each (the oldest go first), and
 * for `maxAgeMs` (MCP_HTTP_FILES_HELD_MAX_AGE_MIN, serve/files.ts). A restart
 * forgets them all: a held client that fetches a file after one is refused,
 * and calls the tool again.
 */

/** The most records kept for one client: well above what one call hands back, and a few MB of memory at most. */
export const OWN_FILES_PER_CLIENT = 10_000;

/** Which file a record is for, as a key. */
const identityOf = (stats: BigIntStats): string => `${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeNs}:${stats.ctimeNs}`;

export type OwnFiles = {
  /**
   * Records, for `client`, the files one of its calls handed back, as they
   * were written. Only regular files inside the outbox, of the size noted,
   * are recorded.
   */
  readonly record: (client: string, handedBack: ReadonlyMap<string, HandedBack>) => void;
  /** Whether the file `stats` describes, opened at `path` below the outbox, is one `client`'s own calls handed back, in a record still kept. */
  readonly holds: (client: string, path: string, stats: BigIntStats) => boolean;
  /** Whether `client` has a record for `path` still kept, whatever is there now. */
  readonly has: (client: string, path: string) => boolean;
};

export type OwnFilesOptions = {
  /** The outbox folder as configured, absolute (MCP_HTTP_FILES_OUTBOX). */
  readonly outbox: string;
  readonly maxAgeMs: number;
  readonly maxPerClient?: number;
  /** The clock, in milliseconds since the epoch. */
  readonly now?: () => number;
};

type Kept = { readonly identity: string; readonly at: number };

export const makeOwnFiles = ({ outbox, maxAgeMs, maxPerClient = OWN_FILES_PER_CLIENT, now = () => Date.now() }: OwnFilesOptions): OwnFiles => {
  const root = resolve(outbox);
  const byClient = new Map<string, Map<string, Kept>>();

  /** A client's records still kept, the expired ones dropped (the oldest come first, so the first one kept ends the look). */
  const keptFor = (client: string): Map<string, Kept> | undefined => {
    const own = byClient.get(client);
    if (own === undefined) return undefined;
    const oldest = now() - maxAgeMs;
    for (const [path, kept] of own) {
      if (kept.at >= oldest) break;
      own.delete(path);
    }
    if (own.size === 0) byClient.delete(client);
    return own.size === 0 ? undefined : own;
  };

  const record = (client: string, handedBack: ReadonlyMap<string, HandedBack>): void => {
    const found: [string, string][] = [];
    for (const [noted, { size, stats }] of handedBack) {
      const path = resolve(noted);
      if (path === root || !isInside(root, path)) continue;
      if (stats === undefined || !stats.isFile() || stats.size !== BigInt(size)) continue;
      found.push([path, identityOf(stats)]);
    }
    if (found.length === 0) return;
    const own = keptFor(client) ?? new Map<string, Kept>();
    byClient.set(client, own);
    const at = now();
    for (const [path, identity] of found) {
      // A path recorded again moves to the end: it is the newest now.
      own.delete(path);
      own.set(path, { identity, at });
    }
    for (const path of own.keys()) {
      if (own.size <= maxPerClient) break;
      own.delete(path);
    }
  };

  const has = (client: string, path: string): boolean => keptFor(client)?.has(resolve(path)) === true;

  const holds = (client: string, path: string, stats: BigIntStats): boolean => keptFor(client)?.get(resolve(path))?.identity === identityOf(stats);

  return { record, holds, has };
};
