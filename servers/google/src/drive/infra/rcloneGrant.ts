import { readFile } from "node:fs/promises";

import { DRIVE } from "../../domain/scopes.js";
import type { ClientConfig, Credentials } from "../../infra/credentials.js";
import { configError, fail } from "../domain/errors.js";

type Scan = { readonly section: string | undefined; readonly found: readonly (readonly [string, string])[] };

/**
 * Read one section of an rclone config.
 *
 * A hand-rolled INI reader rather than a dependency because rclone's format is
 * the trivial subset: `[section]` headers and `key = value` lines, no nesting
 * and no continuations. The value may contain `=` (the token is JSON), so only
 * the FIRST `=` separates.
 */
export const readSection = (ini: string, wanted: string): Readonly<Record<string, string>> =>
  Object.fromEntries(
    ini
      .split("\n")
      .map((line) => line.trim())
      .reduce<Scan>(
        (scan, line) => {
          if (line.startsWith("[") && line.endsWith("]")) return { ...scan, section: line.slice(1, -1).trim() };
          if (scan.section !== wanted || !line || line.startsWith("#") || line.startsWith(";")) return scan;
          const at = line.indexOf("=");
          return at < 1 ? scan : { ...scan, found: [...scan.found, [line.slice(0, at).trim(), line.slice(at + 1).trim()] as const] };
        },
        { section: undefined, found: [] },
      ).found,
  );

const refreshTokenOf = (token: string | undefined, remote: string): string => {
  const parsed = ((): { readonly refresh_token?: unknown } => {
    try {
      return JSON.parse(token ?? "{}") as { readonly refresh_token?: unknown };
    } catch (cause) {
      return fail(configError(`the "${remote}" token is not JSON: ${String(cause)}`));
    }
  })();
  return typeof parsed.refresh_token === "string" && parsed.refresh_token
    ? parsed.refresh_token
    : fail(configError(`the "${remote}" remote holds no refresh token; re-authorise it with rclone`));
};

type RemoteConfig = { readonly rcloneConf: string; readonly rcloneRemote: string };

const sectionOf = async (config: RemoteConfig): Promise<Readonly<Record<string, string>>> => {
  const ini = await readFile(config.rcloneConf, "utf8").catch((cause: unknown) =>
    fail(configError(`cannot read the rclone config at ${config.rcloneConf}: ${String(cause)}`)),
  );
  return readSection(ini, config.rcloneRemote);
};

const clientIn = (section: Readonly<Record<string, string>>, remote: string): ClientConfig => {
  const clientId = section["client_id"];
  const clientSecret = section["client_secret"];
  if (!clientId || !clientSecret) {
    return fail(
      configError(
        `the "${remote}" remote has no client_id/client_secret, so it is on rclone's built-in OAuth client, ` +
          "which this server cannot refresh; give the remote a client_id and client_secret of your own (rclone config), or give Drive its own grant with begin_consent",
      ),
    );
  }
  return { clientId, clientSecret, tokenUri: "https://oauth2.googleapis.com/token" };
};

/** Only the remote's OAuth client: what a consent for Drive's own grant is made on (src/consent). */
export const loadRcloneClient = async (config: RemoteConfig): Promise<ClientConfig> => clientIn(await sectionOf(config), config.rcloneRemote);

/**
 * An rclone remote's grant, read out of its config as credentials the shared
 * token provider refreshes, like Gmail's and Calendar's: for a deployment that
 * already keeps a Drive copy with rclone, on an OAuth client of its own.
 *
 * The refresh token is spent here directly: no rclone process in the path, and
 * the quota is that client's project's. rclone and this server both refresh
 * the one grant, which Google allows: using a refresh token does not use it up.
 *
 * A remote still on rclone's built-in client has no client_id in its section
 * (that pair lives inside the rclone binary), and copying a credential out of
 * another program is not something this server does: that is a config failure
 * naming the fix.
 */
export const loadRcloneCredentials = async (config: RemoteConfig): Promise<Credentials> => {
  const section = await sectionOf(config);
  return {
    ...clientIn(section, config.rcloneRemote),
    refreshToken: refreshTokenOf(section["token"], config.rcloneRemote),
    declaredScopes: [DRIVE],
  };
};
