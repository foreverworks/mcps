import { readFile } from "node:fs/promises";

/**
 * Where one secret comes from: a FILE first (under systemd, its credentials
 * directory, which nothing but the service can read), else a plain variable,
 * for a local stdio run.
 */
export type SecretSource = { readonly file: string; readonly value: string };

/**
 * One secret, read the one way that never quotes it.
 *
 * A named file that cannot be read, or is empty (a tenant without the vault
 * value gets a lone newline), fails through `fail` rather than falling back to
 * the variable: a service configured for files and running without them is a
 * broken deployment. Neither set is `undefined`, because whether that is an
 * error is the server's call (porkbun's documentation tools need no key).
 * `fail` is the server's own config failure, so the remedy stays its own.
 */
export const readSecret = async (
  env: NodeJS.ProcessEnv,
  source: SecretSource,
  fail: (message: string) => never,
): Promise<string | undefined> => {
  const path = env[source.file]?.trim();
  if (!path) {
    const value = env[source.value]?.trim() ?? "";
    return value.length > 0 ? value : undefined;
  }
  const text = await readFile(path, "utf8").catch((cause: unknown) =>
    fail(`${source.file} names ${path}, which cannot be read (${(cause as NodeJS.ErrnoException).code ?? "error"})`),
  );
  const secret = text.trim();
  return secret.length > 0 ? secret : fail(`${source.file} names ${path}, which is empty`);
};
