import { homedir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Where a server's files are, and what it assumes when nobody said.
 *
 * Two kinds of location, two rules:
 *
 * - A CREDENTIAL the operator supplies (an API key, an app registration, a
 *   private key) has no default. A default that points at a real grant is how a
 *   test or a hand-run copy ends up reaching someone's accounts, so the variable
 *   is the only way in, and an unset one is the tool's config failure, naming it.
 * - STATE the server writes itself (token caches, grants it was given through
 *   its own consent tools, stores) has one default for every server:
 *   systemd's StateDirectory when the unit has one, else
 *   `$XDG_STATE_HOME/mcps/<server>` (`~/.local/state/mcps/<server>`). A stdio
 *   user then needs no setup beyond their credentials, and a test, whose HOME is
 *   an empty temp dir (testing/isolate.ts), cannot reach anyone's state.
 */

/** A path from one variable, made absolute; unset or blank (a template that rendered nothing) is `undefined`. */
export const envPath = (env: NodeJS.ProcessEnv, name: string): string | undefined => {
  const value = env[name]?.trim();
  return value ? resolve(value) : undefined;
};

/** The failure's sentence for a credential nobody gave. */
export const unsetPath = (name: string): string => `${name} is not set; this server has no default location`;

/**
 * The directory a server writes its state in: its own variable when set, else
 * the unit's StateDirectory (the first, if systemd lists several), else the
 * user's XDG state directory.
 */
export const stateDirOf = (env: NodeJS.ProcessEnv, server: string, variable: string): string =>
  envPath(env, variable) ??
  envPath({ STATE_DIRECTORY: env["STATE_DIRECTORY"]?.split(":")[0] }, "STATE_DIRECTORY") ??
  join(envPath(env, "XDG_STATE_HOME") ?? join(env["HOME"]?.trim() || homedir(), ".local", "state"), "mcps", server);

/**
 * The IANA time zone a server reads calendar dates in: its own variable when
 * set, else the process's zone (TZ, else the system's). A zone that does not
 * exist is a plain throw: a process that would file every date on the wrong
 * day must not start.
 */
export const timeZoneOf = (env: NodeJS.ProcessEnv, variable: string): string => {
  const named = env[variable]?.trim();
  const zone = named || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    throw new Error(`${named ? variable : "TZ"} "${zone}" is not an IANA time zone`);
  }
  return zone;
};
