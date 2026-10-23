/**
 * Every e-Factura archive under a folder, checked OFFLINE: the ZIP's CRCs,
 * then ANAF's seal on the invoice inside, with the same code as
 * verify_signature's local check (src/infra/seal.ts). Nothing is sent
 * anywhere, and no ANAF download is spent.
 *
 *   npx tsx scripts/check-seals.ts <folder>
 *
 * One line per archive: valid, INVALID (the seal is ANAF's, the invoice is
 * not what it sealed), inconclusive (ask verify_signature, which asks ANAF),
 * corrupt (the archive itself is damaged), or not e-Factura. Exits 1 when any
 * archive is INVALID or corrupt. The last line sums them up, e.g. "12 valid,
 * 1 corrupt, 2 not e-Factura".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { makeSealCheck } from "../src/infra/seal.js";
import { SEAL_ORGANIZATION_IDENTIFIER, sealAnchors } from "../src/infra/sealTrust.js";
import { readInvoiceXml } from "../src/infra/xml.js";
import { readZip } from "../src/infra/zip.js";

const root = process.argv[2];
if (root === undefined) {
  console.error("usage: npx tsx scripts/check-seals.ts <folder>");
  process.exit(2);
}

const archives = (dir: string): readonly string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? archives(path) : name.toLowerCase().endsWith(".zip") ? [path] : [];
  });

const check = makeSealCheck({ anchors: sealAnchors(), organizationIdentifier: SEAL_ORGANIZATION_IDENTIFIER });
const now = Date.now() / 1000;
const counts = new Map<string, number>();

for (const path of archives(root)) {
  const verdict = ((): string => {
    try {
      const entries = readZip(readFileSync(path));
      const seal = entries.filter((e) => e.name.toLowerCase().startsWith("semnatura_"));
      const documents = entries.filter((e) => e.name.toLowerCase().endsWith(".xml") && !seal.includes(e));
      const [invoice] = documents;
      if (seal.length !== 1 || documents.length !== 1 || invoice === undefined) return "not e-Factura";
      const reading = readInvoiceXml(invoice.data.toString("utf8"));
      const result = check(invoice.data, seal[0]?.data ?? Buffer.alloc(0), {
        nowEpoch: now,
        issuedOn: reading.kind === "invoice" ? reading.facts.issueDate : undefined,
      });
      return result.verdict === "valid" ? "valid" : `${result.verdict === "invalid" ? "INVALID" : "inconclusive"}: ${result.reason}`;
    } catch {
      return "corrupt";
    }
  })();
  const kind = verdict.split(":")[0] ?? verdict;
  counts.set(kind, (counts.get(kind) ?? 0) + 1);
  console.log(`${verdict}\t${relative(root, path)}`);
}

console.log(`\n${[...counts].map(([kind, n]) => `${n} ${kind}`).join(", ")}`);
process.exit((counts.get("INVALID") ?? 0) + (counts.get("corrupt") ?? 0) > 0 ? 1 : 0);
