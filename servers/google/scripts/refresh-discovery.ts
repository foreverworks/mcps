/**
 * Refreshes the Discovery documents the editors' batch tools check requests
 * against (`src/<product>/domain/discovery.json`). Run it by hand when Google
 * adds a request kind or a field, then run the tests and commit the result:
 *
 *   npx tsx scripts/refresh-discovery.ts
 *
 * It keeps the API's name, version, revision and schemas, and drops what
 * nothing here reads (methods, parameters, icons). One schema per line, so a
 * refresh diffs by the schema it changed.
 */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const APIS = [
  { product: "docs", api: "docs", version: "v1" },
  { product: "sheets", api: "sheets", version: "v4" },
  { product: "slides", api: "slides", version: "v1" },
] as const;

type Document = { name: string; version: string; revision: string; schemas: Record<string, unknown> };

const serialise = (doc: Document): string => {
  const schemas = Object.keys(doc.schemas)
    .sort()
    .map((id) => `${JSON.stringify(id)}:${JSON.stringify(doc.schemas[id])}`)
    .join(",\n");
  return `{"name":${JSON.stringify(doc.name)},"version":${JSON.stringify(doc.version)},"revision":${JSON.stringify(doc.revision)},"schemas":{\n${schemas}\n}}\n`;
};

for (const { product, api, version } of APIS) {
  const response = await fetch(`https://${api}.googleapis.com/$discovery/rest?version=${version}`);
  if (!response.ok) throw new Error(`${api} ${version}: HTTP ${response.status}`);
  const doc = (await response.json()) as Document;
  const out = join(import.meta.dirname, "..", "src", product, "domain", "discovery.json");
  await writeFile(out, serialise({ name: doc.name, version: doc.version, revision: doc.revision, schemas: doc.schemas }));
  console.log(`${product}: revision ${doc.revision}, ${Object.keys(doc.schemas).length} schemas -> ${out}`);
}
