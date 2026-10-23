import { readFile } from "node:fs/promises";

import { unsetPath } from "@foreverworks/mcp-kit";

import type { CredentialsFile } from "../app/ports.js";
import { configError, fail } from "../domain/errors.js";

/**
 * A reader for a credentials.json of string fields, named for what each field
 * is: `credentialsReader({ refreshToken: "refresh_token", deviceId: "device_id" })`
 * reads `{"refresh_token": "...", "device_id": "..."}` as `{ refreshToken, deviceId }`.
 *
 * The file is read on every call, so a re-seeded credential is picked up
 * without a restart. An unset variable, or a missing, unparseable or
 * incomplete file, is a `config` failure naming the variable or the path and
 * the missing JSON fields; never the values.
 */
export const credentialsReader =
  <K extends string>(fields: Readonly<Record<K, string>>) =>
  async ({ variable, path }: CredentialsFile): Promise<Readonly<Record<K, string>>> => {
    if (path === undefined) return fail(configError(unsetPath(variable)));
    // Neither failure quotes the file: a parse error names the text around the fault, which, for a
    // bare token pasted where JSON should be, is the token.
    const text = await readFile(path, "utf8").catch((cause: NodeJS.ErrnoException) =>
      fail(configError(`credentials at ${path} (${variable}) cannot be read (${cause.code ?? "error"})`)),
    );
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return fail(configError(`credentials at ${path} (${variable}) are not JSON`));
    }
    const object = (typeof raw === "object" && raw !== null ? raw : {}) as Readonly<Record<string, unknown>>;
    const entries = Object.entries(fields) as [K, string][];
    const missing = entries.filter(([, field]) => typeof object[field] !== "string" || !object[field]).map(([, field]) => field);
    if (missing.length > 0) return fail(configError(`credentials at ${path} (${variable}) lack: ${missing.join(", ")}`));
    return Object.fromEntries(entries.map(([key, field]) => [key, String(object[field])])) as Record<K, string>;
  };
