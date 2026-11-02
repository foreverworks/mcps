import { existsSync } from "node:fs";
import { join } from "node:path";

import { envPath, stateDirOf } from "@foreverworks/mcp-kit";

/**
 * The one directory every product's state defaults under: GOOGLE_STATE_DIR,
 * else systemd's StateDirectory, else `$XDG_STATE_HOME/mcps/google`
 * (`%APPDATA%\mcps\google` on Windows). Each product keeps a folder of its own
 * in it, and each folder can be moved by its own variable:
 *
 *   <root>/oauth-client.json        the OAuth client `setup` saved (GOOGLE_OAUTH_CLIENT_FILE)
 *   <root>/gmail/<label>/           Gmail grants, when GMAIL_MODIFY_ACCOUNTS is unset
 *   <root>/gmail/state/<label>/     Gmail token caches (GMAIL_STATE_DIR)
 *   <root>/calendar/<label>/        Calendar grants and their caches (CALENDAR_ROOT)
 *   <root>/drive/state/             Drive's token cache (DRIVE_STATE_DIR)
 *   <root>/drive/credentials.json   Drive's own grant (DRIVE_CREDENTIALS)
 *   <root>/drive/downloads/         download_file's folder (DRIVE_DOWNLOADS_DIR)
 *   <root>/editors/<label>/         Docs, Sheets and Slides grants (GOOGLE_EDITORS_ROOT)
 *   <root>/consent-pending.json     consents waiting for their redirect
 *
 * That is everything `setup` writes, so a server started with no variables at
 * all finds what setup made. A variable that is set always wins over the
 * default, which is how a deployment that lists its paths keeps working.
 */
export const googleStateDir = (env: NodeJS.ProcessEnv): string => stateDirOf(env, "google", "GOOGLE_STATE_DIR");

/** Which setting decided the state directory, for health to say. */
export const stateDirFrom = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): string =>
  envPath(env, "GOOGLE_STATE_DIR")
    ? "GOOGLE_STATE_DIR"
    : env["STATE_DIRECTORY"]?.trim()
      ? "STATE_DIRECTORY"
      : envPath(env, "XDG_STATE_HOME")
        ? "XDG_STATE_HOME"
        : platform === "win32" && envPath(env, "APPDATA")
          ? "APPDATA"
          : "the home directory";

/** The file `setup` saves the OAuth client in, inside the state directory. */
export const OAUTH_CLIENT_FILE = "oauth-client.json";

/** Where the OAuth client new grants are made on comes from. */
export type ClientSource = { readonly path: string; readonly from: "GOOGLE_OAUTH_CLIENT_FILE" | "setup" };

/**
 * The OAuth client new grants are made on: GOOGLE_OAUTH_CLIENT_FILE when it is
 * set, else the one `setup` saved in the state directory, if it did. Read when
 * a consent begins, not at start, so a client saved while the server runs is
 * used at once.
 *
 * The kit gives a credential no default location (packages/mcp-kit env.ts),
 * so a test or a hand-run copy cannot reach someone's real one. This file is
 * not a default in that sense: it is state the server's own setup wrote, under
 * the state directory, which a test's empty HOME keeps out of reach.
 */
export const oauthClientOf = (env: NodeJS.ProcessEnv, exists: (path: string) => boolean = existsSync): ClientSource | undefined => {
  const named = envPath(env, "GOOGLE_OAUTH_CLIENT_FILE");
  if (named) return { path: named, from: "GOOGLE_OAUTH_CLIENT_FILE" };
  const saved = join(googleStateDir(env), OAUTH_CLIENT_FILE);
  return exists(saved) ? { path: saved, from: "setup" } : undefined;
};

/**
 * Where Gmail's grants are found when GMAIL_MODIFY_ACCOUNTS does not list
 * them: `<root>/gmail/<label>/credentials.json`, one per mailbox, as Calendar
 * keeps its own. Its `state/` folder holds the token caches, never a label.
 */
export const gmailGrantRootOf = (env: NodeJS.ProcessEnv): string => join(googleStateDir(env), "gmail");
