import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * No source file holds the global `fetch` as a value.
 *
 * `serve` puts the MCP_EGRESS_ALLOW guard on `globalThis.fetch`, and every
 * server builds its dependencies before it serves. A client that takes `fetch`
 * while it is built (a default, an option, a field) keeps the function that
 * existed then, so its requests are never checked against the list. The Bolt
 * Food and Glovo clients did exactly that. A fetch kept as a value is the
 * kit's `liveFetch`, which reads the global at every call; calling `fetch(...)`
 * directly is fine too, because that reads it at the call.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where the guard itself is installed: the one place that must read the function it wraps. */
const INSTALLS_THE_GUARD = "packages/mcp-kit/src/serve/egress.ts";

/** A bare `fetch` (or `globalThis.fetch`) that is not called on the spot. */
const BARE = String.raw`(?:globalThis\.)?fetch\b(?![\s]*[(.])`;
const CAPTURES: readonly RegExp[] = [
  // a default, a fallback or an assignment: `= fetch`, `?? fetch`, `|| globalThis.fetch`
  new RegExp(String.raw`(?:\?\?|\|\||=)\s*${BARE}`),
  // handed on as a value: `f(fetch)`, `{ fetch: fetch }`, `[fetch, x]`
  new RegExp(String.raw`[(,:[]\s*${BARE}\s*[,)\]}]`),
  // a shorthand property or a destructuring that reads it off the global: `{ fetch }`, `const { fetch } = globalThis`
  /\{\s*fetch\s*[,}]/,
  /\{[^}]*\bfetch\b[^}]*\}\s*=\s*globalThis\b/,
  // bound to something now
  /\bfetch\.bind\b/,
];

/** Whether one line of source takes `fetch` as a value. Comments and strings are not source. */
const capturesFetch = (line: string): boolean => {
  if (/^\s*(?:\*|\/\*)/.test(line)) return false;
  const code = line.replace(/\/\/.*$/, "").replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""');
  return CAPTURES.some((pattern) => pattern.test(code));
};

const sourcesIn = (dir: string): string[] =>
  readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"))
    .map((entry) => join(dir, entry.parentPath.slice(join(ROOT, dir).length), entry.name));

/** Every workspace's `src`: the code that ships. Tests, scripts and the test setup stub fetch on purpose. */
const shipped = (): string[] =>
  ["packages", "servers"].flatMap((group) =>
    readdirSync(join(ROOT, group), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => (readdirSync(join(ROOT, group, entry.name)).includes("src") ? sourcesIn(join(group, entry.name, "src")) : [])),
  );

describe("capturesFetch", () => {
  it.each([
    "const { fetch: doFetch = fetch, now = Date.now } = options;",
    "const doFetch = options.fetch ?? fetch;",
    "const doFetch = options.fetch ?? globalThis.fetch;",
    "const inner = globalThis.fetch;",
    "const { fetch } = globalThis;",
    "const send = fetch.bind(globalThis);",
    "return makeThing({ fetch: fetch, sleep });",
    "return makeThing({ fetch });",
    "return makeThing(fetch);",
    "return makeThing(a, fetch, b);",
    "  fetch: throttleAs429(fetch),",
  ])("flags %s", (line) => {
    expect(capturesFetch(line)).toBe(true);
  });

  it.each([
    "const doFetch = options.fetch ?? liveFetch;",
    "const { fetch: injected, ...options } = given;",
    "const send: typeof fetch = injected ?? ((input, init) => fetch(input, init));",
    "readonly fetch?: typeof fetch;",
    "export type Options = HttpOptions & { readonly fetch?: typeof fetch };",
    "fetch: (input, init) => throttle(() => fetch(input, init)),",
    "const response = await fetch(url, { method });",
    "const response = await globalThis.fetch(url);",
    "...(options.fetch === undefined ? {} : { fetch: options.fetch }),",
    "// the fetch the guard wraps = fetch",
    " * a doc comment that says `?? fetch` is wrong",
    'const text = "a fetch = fetch in a string";',
    "type Hold = (input: Parameters<typeof fetch>[0]) => void;",
  ])("lets %s be", (line) => {
    expect(capturesFetch(line)).toBe(false);
  });
});

describe("the code that ships", () => {
  it("never keeps the global fetch as a value, so MCP_EGRESS_ALLOW reaches every request", () => {
    const files = shipped();
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .filter((file) => file !== INSTALLS_THE_GUARD)
      .flatMap((file) =>
        readFileSync(join(ROOT, file), "utf8")
          .split("\n")
          .flatMap((line, index) => (capturesFetch(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [])),
      );
    expect(offenders, "keep `liveFetch` (from @foreverworks/mcp-kit) as the value, not `fetch`").toEqual([]);
  });
});
