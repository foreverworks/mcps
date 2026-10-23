import { readFileSync } from "node:fs";

/**
 * The version a server announces at initialize, read from its own package.json,
 * so the number a client sees is the number that was released.
 *
 * `entryUrl` is the entry module's `import.meta.url`. The built `dist/index.js`
 * and the source `src/index.ts` (under `tsx`) both sit one folder below the
 * package root, so the same relative path finds it either way.
 */
export const packageVersion = (entryUrl: string): string => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", entryUrl), "utf8")) as { readonly version?: unknown };
  if (typeof pkg.version !== "string" || pkg.version.length === 0) throw new Error(`no version in the package.json beside ${entryUrl}`);
  return pkg.version;
};
