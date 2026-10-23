import { stateDirOf } from "@foreverworks/mcp-kit";

/**
 * The one directory every product's state defaults under: GOOGLE_STATE_DIR,
 * else systemd's StateDirectory, else `$XDG_STATE_HOME/mcps/google`. Each
 * product keeps a folder of its own in it, and each folder can be moved by its
 * own variable:
 *
 *   <root>/gmail/state/<label>/     Gmail token caches (GMAIL_STATE_DIR)
 *   <root>/calendar/<label>/        Calendar grants and their caches (CALENDAR_ROOT)
 *   <root>/drive/state/             Drive's token cache (DRIVE_STATE_DIR)
 *   <root>/drive/credentials.json   Drive's own grant (DRIVE_CREDENTIALS)
 *   <root>/drive/downloads/         download_file's folder (DRIVE_DOWNLOADS_DIR)
 *   <root>/editors/<label>/         Docs, Sheets and Slides grants (GOOGLE_EDITORS_ROOT)
 *   <root>/consent-pending.json     consents waiting for their redirect
 */
export const googleStateDir = (env: NodeJS.ProcessEnv): string => stateDirOf(env, "google", "GOOGLE_STATE_DIR");
