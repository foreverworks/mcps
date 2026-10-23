import { existsSync } from "node:fs";

import { fileTokenStore, type InputFiles, inputFilesFrom, inputFilesWith, noteHandedBack, writeFileAtomic } from "@foreverworks/mcp-kit";

import { type ClientConfig, loadCredentials, readClient } from "../infra/credentials.js";
import { makeRequest, type Tokens } from "../infra/httpJson.js";
import { makeTokenProvider, type TokenProvider } from "../infra/oauth.js";
import type { Deps, Downloads, Grant } from "./app/ports.js";
import { configError, fail } from "./domain/errors.js";
import { MAX_UPLOAD_BYTES } from "./domain/upload.js";
import { makeDriveApi } from "./infra/driveApi.js";
import { type Config, resolveConfig } from "./infra/paths.js";
import { loadRcloneClient, loadRcloneCredentials } from "./infra/rcloneGrant.js";

/** Drive's one grant: the token source, what to call it, and what a consent needs to replace it. */
export type DriveGrant = {
  readonly tokens: TokenProvider;
  /** Which grant is in use NOW: Drive's own once its file exists, an rclone remote's until then. */
  readonly grant: () => Grant;
  /** Where Drive's own grant is (or will be) saved. */
  readonly credentials: string;
  /** The OAuth client a new own grant is made on: the own grant's, else the rclone remote's. */
  readonly client: () => Promise<ClientConfig>;
};

const ownGrant = (config: Config): boolean => existsSync(config.credentials);

/** Drive has neither grant: what to do about it, naming the variables. */
const noGrant = (config: Config): string =>
  `Drive has no grant: ${config.credentials} does not exist (DRIVE_CREDENTIALS) and DRIVE_RCLONE_CONF is not set`;

/** The rclone remote, when one is configured. */
const rclone = (config: Config) => (config.rcloneConf === undefined ? undefined : { rcloneConf: config.rcloneConf, rcloneRemote: config.rcloneRemote });

/**
 * The grant, built once per process, and chosen at every mint rather than at
 * start: a consent that writes Drive's own grant takes effect on the next
 * token, with no restart. Docs, Sheets and Slides run the account
 * GOOGLE_EDITORS_DRIVE_ACCOUNT names on this same provider (src/editors): one
 * cache, one refresh.
 */
export const buildGrant = (env: NodeJS.ProcessEnv = process.env): DriveGrant => {
  const config = resolveConfig(env);
  return {
    tokens: makeTokenProvider(() => {
      if (ownGrant(config)) return loadCredentials(config.credentials);
      const remote = rclone(config);
      return remote ? loadRcloneCredentials(remote) : fail(configError(noGrant(config)));
    }, fileTokenStore(config.stateDir)),
    grant: () => {
      if (ownGrant(config)) return { source: "credentials", detail: config.credentials };
      const remote = rclone(config);
      return remote ? { source: "rclone", detail: `${remote.rcloneRemote} in ${remote.rcloneConf}` } : { source: "none", detail: noGrant(config) };
    },
    credentials: config.credentials,
    client: async () => {
      const own = await readClient(config.credentials);
      if (own) return own;
      const remote = rclone(config);
      return remote ? loadRcloneClient(remote) : fail(configError("no OAuth client is known for Drive: set GOOGLE_OAUTH_CLIENT_FILE"));
    },
  };
};

/**
 * Drive on any grant. The Drive product runs it on its own grant; Docs,
 * Sheets and Slides run it on whichever account they act as (src/editors), so
 * a copy, a create in a folder or a path walk is this adapter everywhere.
 */
export const depsFor = (
  tokens: Tokens,
  grant: () => Grant,
  readInput: InputFiles = inputFilesWith([]),
  { mirror, downloads }: { readonly mirror?: string | undefined; readonly downloads?: Downloads } = {},
): Deps => ({
  drive: makeDriveApi(
    makeRequest(tokens, { service: "Google Drive", quotaFloorMs: 22_000 }),
    makeRequest(tokens, { service: "Google Drive", quotaFloorMs: 22_000, timeoutMs: UPLOAD_TIMEOUT_MS }),
  ),
  grant,
  readInput,
  ...(mirror === undefined ? {} : { mirror }),
  ...(downloads === undefined ? {} : { downloads }),
});

/** An upload of the largest file this server takes, on a slow day. */
const UPLOAD_TIMEOUT_MS = 300_000;

/**
 * The composition root: the ONLY module that names both a port and the thing
 * implementing it. The grant is chosen here and nowhere else.
 */
export const buildDeps = (env: NodeJS.ProcessEnv = process.env, driveGrant: DriveGrant = buildGrant(env)): Deps => {
  const config = resolveConfig(env);
  return depsFor(driveGrant.tokens, driveGrant.grant, readerFor(env, config.mirror), {
    mirror: config.mirror,
    downloads: {
      dir: config.downloads,
      save: async (dir, name, bytes) => {
        const path = await writeFileAtomic(dir, name, bytes);
        noteHandedBack(path, bytes.length);
        return path;
      },
    },
  });
};

/**
 * Uploads read the server's file roots (MCP_FILE_ROOTS), and the Drive mirror
 * too where one is configured: the mirror is a root of its own, so a file
 * there is read in place and checked like any other.
 */
const readerFor = (env: NodeJS.ProcessEnv, mirror: string | undefined): InputFiles => {
  const inbox = inputFilesFrom(env, { maxBytes: MAX_UPLOAD_BYTES });
  if (mirror === undefined) return inbox;
  return inputFilesWith([...inbox.roots, mirror], { maxBytes: MAX_UPLOAD_BYTES, script: env["MCP_FILE_SCRIPT"]?.trim() || undefined });
};
