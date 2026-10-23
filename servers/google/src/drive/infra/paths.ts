import { join } from "node:path";

import { envPath } from "@foreverworks/mcp-kit";

import { googleStateDir } from "../../infra/locations.js";

export type Config = {
  /**
   * Drive's OWN grant, a google.oauth2 credentials JSON made by begin_consent
   * (product drive). Used whenever the file exists; until then the grant is
   * borrowed from an rclone remote, when one is configured.
   */
  readonly credentials: string;
  /** An rclone config whose remote's grant Drive borrows until it has its own; none by default. */
  readonly rcloneConf: string | undefined;
  readonly rcloneRemote: string;
  /** The access-token cache, whichever grant is in use. */
  readonly stateDir: string;
  /** A local copy of My Drive this process can read (DRIVE_MIRROR_ROOT); none by default. */
  readonly mirror: string | undefined;
  /** Where download_file saves (DRIVE_DOWNLOADS_DIR): a folder the caller can read. */
  readonly downloads: string;
};

/**
 * Where Drive's files are. Everything the server writes defaults under one
 * folder of its state directory, `<GOOGLE_STATE_DIR>/drive/`, each part
 * movable by its own variable. The rclone config is a credential someone
 * else keeps, so it has no default: unset, Drive runs on its own grant alone.
 */
export const resolveConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const root = join(googleStateDir(env), "drive");
  return {
    credentials: envPath(env, "DRIVE_CREDENTIALS") ?? join(root, "credentials.json"),
    rcloneConf: envPath(env, "DRIVE_RCLONE_CONF"),
    rcloneRemote: env["DRIVE_RCLONE_REMOTE"]?.trim() || "gdrive",
    stateDir: envPath(env, "DRIVE_STATE_DIR") ?? join(root, "state"),
    mirror: envPath(env, "DRIVE_MIRROR_ROOT"),
    downloads: envPath(env, "DRIVE_DOWNLOADS_DIR") ?? join(root, "downloads"),
  };
};
