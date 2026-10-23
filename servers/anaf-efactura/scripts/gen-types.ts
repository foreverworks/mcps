/**
 * Regenerates ANAF's wire types from ANAF's own OpenAPI documents.
 *
 *   npm run gen:types -w @foreverworks/mcp-anaf-efactura              # fetch, snapshot, generate
 *   npm run gen:types -w @foreverworks/mcp-anaf-efactura -- --offline # generate from openapi/*.json
 *
 * ANAF publishes no .json or .yaml file. Each service has a Swagger UI page on
 * mfinante.gov.ro, and the OpenAPI 3.0.1 document is embedded in that page as a
 * JavaScript object literal (`var spec = {...}`). This script cuts the literal
 * out, parses it as JSON5 (it is data, never evaluated), keeps a pretty-printed
 * snapshot in openapi/, and runs openapi-typescript over it into
 * src/domain/generated/.
 *
 * mfinante.gov.ro resets connections from outside Romania (measured
 * 2026-09-28). ANAF_SPEC_MIRROR prefixes every URL,
 * so an Internet Archive copy can stand in:
 *
 *   ANAF_SPEC_MIRROR=http://web.archive.org/web/2025id_/ npm run gen:types ...
 *
 * The header of each generated file names the URL actually read and the date.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import JSON5 from "json5";
import openapiTS, { astToString, type OpenAPI3 } from "openapi-typescript";

type Source = { readonly name: string; readonly page: string; readonly covers: string };

const SOURCES: readonly Source[] = [
  { name: "efactura-upload", page: "https://mfinante.gov.ro/static/10/eFactura/upload.html", covers: "e-Factura /upload" },
  {
    name: "efactura-stare-mesaj",
    page: "https://mfinante.gov.ro/static/10/eFactura/staremesaj.html",
    covers: "e-Factura /stareMesaj",
  },
  {
    name: "efactura-lista-mesaje",
    page: "https://mfinante.gov.ro/static/10/eFactura/listamesaje.html",
    covers: "e-Factura /listaMesajeFactura and /listaMesajePaginatieFactura",
  },
  {
    name: "efactura-descarcare",
    page: "https://mfinante.gov.ro/static/10/eFactura/descarcare.html",
    covers: "e-Factura /descarcare",
  },
  {
    name: "efactura-validare",
    page: "https://mfinante.gov.ro/static/10/eFactura/validare.html",
    covers: "e-Factura /validare/{standard}",
  },
  {
    name: "efactura-transformare",
    page: "https://mfinante.gov.ro/static/10/eFactura/xmltopdf.html",
    covers: "e-Factura /transformare/{standard} and /transformare/{standard}/{novld}",
  },
  {
    name: "efactura-validare-semnatura",
    page: "https://mfinante.gov.ro/static/10/eFactura/validaresemnatura.html",
    covers: "the e-Factura seal check, /api/validate/signature",
  },
  {
    name: "etransport-lista",
    page: "https://mfinante.gov.ro/static/10/eTransport/lista.html",
    covers: "e-Transport /ws/v1/lista/{zile}/{cif}",
  },
];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const snapshotPath = (name: string): string => join(root, "openapi", `${name}.json`);
const generatedPath = (name: string): string => join(root, "src", "domain", "generated", `${name}.ts`);

/**
 * The object literal assigned to `var spec`, found by matching braces outside
 * string literals. A regex would stop at the first `}` inside an example body.
 */
export const specLiteral = (html: string): string => {
  const at = html.search(/var\s+spec\s*=/);
  const start = at < 0 ? -1 : html.indexOf("{", at);
  if (start < 0) throw new Error("no `var spec = {...}` in the page");
  type Scan = { readonly depth: number; readonly quote: string | undefined; readonly escaped: boolean };
  const step = (s: Scan, c: string): Scan => {
    if (s.quote !== undefined) {
      if (s.escaped) return { ...s, escaped: false };
      if (c === "\\") return { ...s, escaped: true };
      return c === s.quote ? { ...s, quote: undefined } : s;
    }
    if (c === '"' || c === "'" || c === "`") return { ...s, quote: c };
    if (c === "{") return { ...s, depth: s.depth + 1 };
    if (c === "}") return { ...s, depth: s.depth - 1 };
    return s;
  };
  // A fold with an early exit. The state is rebound, never changed in place.
  let scan: Scan = { depth: 0, quote: undefined, escaped: false };
  for (let i = start; i < html.length; i += 1) {
    scan = step(scan, html[i] as string);
    if (scan.depth === 0) return html.slice(start, i + 1);
  }
  throw new Error("unbalanced braces after `var spec =`");
};

/**
 * JSON5 covers the unquoted keys and trailing commas these pages use, but not
 * a bare number as a key (`200: {...}`), which is JavaScript and not JSON5.
 * Those only ever open a line (response codes), so quoting them there is enough
 * and cannot reach into a string value.
 */
export const parseLiteral = (literal: string): OpenAPI3 =>
  JSON5.parse(literal.replace(/^(\s*)(\d+)(\s*:)/gm, '$1"$2"$3')) as OpenAPI3;

const fetchSpec = async (source: Source, mirror: string): Promise<{ readonly spec: OpenAPI3; readonly readFrom: string }> => {
  const response = await fetch(`${mirror}${source.page}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`${source.page}: HTTP ${response.status}`);
  return { spec: parseLiteral(specLiteral(await response.text())), readFrom: response.url };
};

const header = (source: Source, readFrom: string, date: string): string =>
  [
    "/**",
    ` * GENERATED by \`npm run gen:types\` (scripts/gen-types.ts). Do not edit by hand.`,
    ` *`,
    ` * ANAF's own OpenAPI 3.0.1 document for ${source.covers}, embedded in the`,
    ` * Swagger UI page ${source.page}`,
    ` * Read from: ${readFrom}`,
    ` * Generated: ${date}. Snapshot of the document: openapi/${source.name}.json`,
    " */",
    "",
  ].join("\n");

const generate = async (source: Source, spec: OpenAPI3, readFrom: string, date: string): Promise<void> => {
  const ast = await openapiTS(spec, { immutable: true, alphabetize: true, silent: true });
  await mkdir(dirname(generatedPath(source.name)), { recursive: true });
  await writeFile(generatedPath(source.name), `${header(source, readFrom, date)}${astToString(ast)}`);
};

const main = async (): Promise<void> => {
  const offline = process.argv.includes("--offline");
  const mirror = process.env["ANAF_SPEC_MIRROR"] ?? "";
  const date = new Date().toISOString().slice(0, 10);
  await mkdir(join(root, "openapi"), { recursive: true });
  for (const source of SOURCES) {
    if (offline) {
      const snapshot = JSON.parse(await readFile(snapshotPath(source.name), "utf8")) as OpenAPI3 & {
        readonly "x-read-from"?: string;
      };
      await generate(source, snapshot, snapshot["x-read-from"] ?? source.page, date);
    } else {
      const { spec, readFrom } = await fetchSpec(source, mirror);
      await writeFile(snapshotPath(source.name), `${JSON.stringify({ ...spec, "x-read-from": readFrom }, null, 2)}\n`);
      await generate(source, spec, readFrom, date);
    }
    console.log(`${source.name}: ok`);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
