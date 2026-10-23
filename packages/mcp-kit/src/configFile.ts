import { readFile } from "node:fs/promises";

import { issuesText, type Issues } from "./issues.js";

type Parser<T> = { readonly safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: Issues } };

/**
 * A config file a human wrote once (app.json), read the one way that never
 * quotes it: these files hold a client secret or a private key.
 *
 * Unreadable says the errno code, not the message; a file that is not JSON
 * says only that, because V8's parse error quotes the text around the fault;
 * a document of the wrong shape names the fields (issues.ts), never a value.
 * `fail` is the server's own config failure, so the remedy stays its own.
 */
export const readConfigFile = async <T>(path: string, schema: Parser<T>, fail: (message: string) => never): Promise<T> => {
  const raw = await readFile(path, "utf8").catch((cause: unknown) =>
    fail(`app config at ${path} cannot be read (${(cause as NodeJS.ErrnoException).code ?? "error"})`),
  );
  const json = ((): unknown => {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return fail(`app config at ${path} is not JSON`);
    }
  })();
  const parsed = schema.safeParse(json);
  return parsed.success ? parsed.data : fail(`app config at ${path} lacks or mistypes: ${issuesText(parsed.error)}`);
};
