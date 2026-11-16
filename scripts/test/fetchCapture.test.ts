import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { parseSync } from "rolldown/utils";
import { describe, expect, it } from "vitest";

/**
 * No source file holds the global `fetch` as a value.
 *
 * `serve` puts the MCP_EGRESS_ALLOW guard on `globalThis.fetch`, and every
 * server builds its dependencies before it serves. A client that takes `fetch`
 * while it is built (a default, an option, a field) keeps the function that
 * existed then, so its requests are never checked against the list. The Bolt
 * Food and Glovo clients did exactly that. A fetch kept as a value is the
 * kit's `liveFetch`, which reads the global at every call.
 *
 * The check reads each file's syntax tree, so layout, comments and strings
 * cannot hide or fake a use. Every use of `fetch` (the identifier, or
 * `globalThis.fetch`, `globalThis['fetch']`) is fine where it is called on the
 * spot (`fetch(url)` reads the global at the call), asked about (`typeof
 * fetch`), compared (`x === fetch`), or a name being declared or written
 * (`const fetch`, a parameter, an object key, `options.fetch`, an assignment
 * to it); anywhere else it hands the function on, and is flagged. It follows no
 * alias: `const g = globalThis; g.fetch` is beyond it, and beyond review only
 * if the reviewer stops reading.
 *
 * (The parser is the one vitest's own bundler ships, declared as a dev
 * dependency here: TypeScript 7's compiler has no parser a script can call.)
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where the guard itself is installed: the one place that must read the function it wraps. */
const INSTALLS_THE_GUARD = "packages/mcp-kit/src/serve/egress.ts";

type Node = { readonly type: string; readonly start: number; readonly [key: string]: unknown };
/** A node's place in its parent: the parent, and the property of the parent it hangs from. */
type Place = { readonly parent: Node; readonly key: string };

const isNode = (value: unknown): value is Node => typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
const isIdentifier = (node: unknown, name: string): boolean => isNode(node) && node.type === "Identifier" && node.name === name;

/** The text a literal or an expression-free template holds, so `['fetch']` and `[`fetch`]` are read as `.fetch`. */
const textOf = (node: unknown): string | undefined => {
  if (!isNode(node)) return undefined;
  if (node.type === "Literal") return typeof node.value === "string" ? node.value : undefined;
  if (node.type !== "TemplateLiteral" || !Array.isArray(node.quasis) || node.quasis.length !== 1) return undefined;
  const cooked = ((node.quasis[0] as Node).value as { readonly cooked?: unknown } | undefined)?.cooked;
  return typeof cooked === "string" ? cooked : undefined;
};

/** `globalThis.fetch`, `globalThis['fetch']`, `global.fetch`. */
const isGlobalFetch = (node: Node): boolean =>
  node.type === "MemberExpression" && (isIdentifier(node.object, "globalThis") || isIdentifier(node.object, "global")) && (node.computed === true ? textOf(node.property) === "fetch" : isIdentifier(node.property, "fetch"));

const COMPARISONS = new Set(["==", "===", "!=", "!=="]);
/** A TypeScript wrapper around an expression: the expression inside is still used as a value. */
const WRAPS_AN_EXPRESSION = new Set(["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion", "TSInstantiationExpression"]);

/** Whether `parent` takes the node it holds under `key` as a value (true) or as a call, a question, a comparison or a name (false). */
const handsOn = ({ parent, key }: Place, grandparent: Node | undefined): boolean => {
  switch (parent.type) {
    case "CallExpression":
    case "NewExpression":
      return key !== "callee";
    case "UnaryExpression":
      return parent.operator !== "typeof";
    case "BinaryExpression":
      return !COMPARISONS.has(parent.operator as string);
    case "MemberExpression":
      // `options.fetch` names a property; `fetch.bind` and `x[fetch]` use the value.
      return key === "object" || parent.computed === true;
    case "Property":
      // `{ fetch: x }`, `{ fetch }` in a pattern: a name. In an object literal the value is used.
      return key === "key" ? parent.computed === true : grandparent?.type !== "ObjectPattern";
    case "PropertyDefinition":
    case "AccessorProperty":
    case "MethodDefinition":
      return key === "value" || parent.computed === true;
    case "VariableDeclarator":
      return key === "init";
    case "AssignmentExpression":
      return key === "right";
    case "AssignmentPattern":
      return key === "right";
    case "ArrowFunctionExpression":
      return key === "body";
    case "ClassDeclaration":
    case "ClassExpression":
      return key === "superClass";
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "RestElement":
    case "ArrayPattern":
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return false;
    case "ExportSpecifier":
      return key === "local";
    case "CatchClause":
      return key !== "param";
    default:
      // A type (`typeof fetch` as a type, a property signature, a type reference) is not a value.
      return !parent.type.startsWith("TS") || WRAPS_AN_EXPRESSION.has(parent.type);
  }
};

/** A destructuring of `fetch` out of the global: `const { fetch } = globalThis`. */
const takesFetchOffGlobal = (pattern: unknown, source: unknown): boolean =>
  isNode(pattern) &&
  pattern.type === "ObjectPattern" &&
  Array.isArray(pattern.properties) &&
  (isIdentifier(source, "globalThis") || isIdentifier(source, "global")) &&
  pattern.properties.some((property: Node) => property.type === "Property" && (property.computed === true ? textOf(property.key) === "fetch" : isIdentifier(property.key, "fetch")));

/** Where in `text` (an offset) each use of the global `fetch` as a value is. */
const capturesIn = (file: string, text: string): readonly number[] => {
  const parsed = parseSync(file, text, { lang: "ts", sourceType: "module", preserveParens: false });
  if (parsed.errors.length > 0) throw new Error(`${file} does not parse: ${parsed.errors[0]?.message ?? "unknown error"}`);
  const found: number[] = [];
  const walk = (node: Node, ancestors: readonly Place[]): void => {
    const place = ancestors.at(-1);
    const grandparent = ancestors.at(-2)?.parent;
    if (place !== undefined && (isIdentifier(node, "fetch") || isGlobalFetch(node)) && handsOn(place, grandparent)) found.push(node.start);
    if (node.type === "VariableDeclarator" && takesFetchOffGlobal(node.id, node.init)) found.push(node.start);
    if (node.type === "AssignmentExpression" && takesFetchOffGlobal(node.left, node.right)) found.push(node.start);
    for (const [key, value] of Object.entries(node)) {
      for (const child of Array.isArray(value) ? value : [value]) {
        if (isNode(child)) walk(child, [...ancestors, { parent: node, key }]);
      }
    }
  };
  walk(parsed.program as unknown as Node, []);
  return found;
};

const lineOf = (text: string, offset: number): number => text.slice(0, offset).split("\n").length;

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

describe("the scan for a fetch held as a value", () => {
  it.each([
    "const doFetch = options.fetch ?? fetch;",
    "const { fetch: doFetch = fetch, now = Date.now } = options;",
    "const inner = globalThis.fetch;",
    "const inner = global.fetch;",
    "const g = globalThis['fetch'];",
    'const g = globalThis["fetch"];',
    "const g = globalThis[`fetch`];",
    "const { fetch } = globalThis;",
    "const { fetch: held } = globalThis;",
    "const send = fetch.bind(globalThis);",
    "const send = globalThis.fetch.bind(globalThis);",
    "make({ fetch: fetch, sleep });",
    "make({ fetch });",
    "make(fetch);",
    "make(a, fetch, b);",
    "const policy = {\n  retries: 2,\n  fetch,\n};",
    "const list = [\n  fetch,\n];",
    "const f = c ? fetch : other;",
    "const f = c ? other : globalThis.fetch;",
    "export default fetch;",
    "export { fetch };",
    "const f = () => fetch;",
    "const f = fetch as typeof globalThis.fetch;",
    "const f = fetch!;",
    "const f = (fetch);",
    "const f = a || fetch;",
    "const h = makeThing({ fetch: throttle(fetch) });",
    "function use(held = fetch) { return held; }",
    "class Client { held = fetch; }",
  ])("flags %j", (source) => {
    expect(capturesIn("case.ts", source).length).toBeGreaterThan(0);
  });

  it.each([
    "const doFetch = options.fetch ?? liveFetch;",
    "const { fetch: injected, ...options } = given;",
    "const send: typeof fetch = injected ?? ((input, init) => fetch(input, init));",
    "type Options = { readonly fetch?: typeof fetch };",
    "type Held = Parameters<typeof fetch>[0];",
    "const response = await fetch(url, { method });",
    "const response = await globalThis.fetch(url);",
    "const response = await globalThis['fetch'](url);",
    "const response = await (fetch)(url);",
    "const ok = x === fetch;",
    "const ok = fetch !== x;",
    "const kind = typeof fetch;",
    "const kind = typeof globalThis.fetch;",
    "const o = { fetch: options.fetch };",
    "options.fetch = 1;",
    "globalThis.fetch = guard;",
    "function use(fetch: typeof globalThis.fetch) { return fetch(1); }",
    "const fetch = makeFetch();",
    "const g = ({ fetch }: { fetch: typeof globalThis.fetch }) => fetch(1);",
    "import { fetch as undiciFetch } from 'undici';",
    "// the fetch the guard wraps = fetch\nconst a = 1;",
    "const text = 'a fetch = fetch in a string';",
    "const text = `held ${String(1)} fetch, in a template`;",
  ])("lets %j be", (source) => {
    expect(capturesIn("case.ts", source)).toEqual([]);
  });
});

describe("the code that ships", () => {
  it("never keeps the global fetch as a value, so MCP_EGRESS_ALLOW reaches every request", () => {
    const files = shipped();
    expect(files.length).toBeGreaterThan(100);
    const offenders = files
      .filter((file) => file !== INSTALLS_THE_GUARD)
      .flatMap((file) => {
        const text = readFileSync(join(ROOT, file), "utf8");
        return capturesIn(file, text).map((offset) => `${file}:${lineOf(text, offset)}: ${(text.split("\n")[lineOf(text, offset) - 1] ?? "").trim()}`);
      });
    expect(offenders, "keep `liveFetch` (from @foreverworks/mcp-kit) as the value, not `fetch`").toEqual([]);
  });
});
