/**
 * Records ANAF's validator answer for each invoice build_invoice is tested on
 * (test/buildCases.ts), so the tests can hold every built file to ANAF's own
 * verdict without calling ANAF.
 *
 *   npx tsx scripts/record-validation.ts                  # build each case and compare with the recording; sends nothing
 *   npx tsx scripts/record-validation.ts --send [case...] # send the built files to ANAF's validator and record its answers
 *   ... --identified                                       # the foreign-buyer cases' variants (test/buildCases.ts)
 *
 * The validator is ANAF's public /validare/FACT1 on webservicesp.anaf.ro: it
 * takes no grant and files nothing. The cases are invented data. With --send,
 * each file goes once, five seconds apart, and its answer is written to
 * test/fixtures/validation/<case>.json with the SHA-256 of the bytes ANAF
 * judged and the date. Run it again after any change to what the builder
 * writes: the tests fail until the recording matches the bytes.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { sha256Of } from "@foreverworks/mcp-kit";

import { buildDeps } from "../src/composition.js";
import { buildInvoiceXml, draftProblems, normalDraft } from "../src/domain/invoiceBuild.js";
import { verdictOf } from "../src/domain/validation.js";
import { ANAF_PUBLIC } from "../src/infra/config.js";
import { parseBuildArgs, toDraft } from "../src/mcp/buildArgs.js";
import { BUILD_CASES, type BuildCase, FOREIGN_BUYER_CASES, identifiedVariant } from "../test/buildCases.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const recordingPath = (name: string): string => join(root, "test", "fixtures", "validation", `${name}.json`);

const GAP_MS = 5_000;

/** A case's file, or with `identified` its variant with a Romanian-format buyer id (test/buildCases.ts). */
export const builtCase = (name: BuildCase, identified = false): string => {
  const raw = identified && (FOREIGN_BUYER_CASES as readonly string[]).includes(name) ? identifiedVariant(name as (typeof FOREIGN_BUYER_CASES)[number]) : BUILD_CASES[name];
  const draft = normalDraft(toDraft(parseBuildArgs(raw)));
  const problems = draftProblems(draft);
  if (problems.length > 0) throw new Error(`${name}: ${problems.join("; ")}`);
  return buildInvoiceXml(draft).xml;
};

const recorded = async (name: string): Promise<{ readonly sha256?: string } | undefined> => {
  try {
    return JSON.parse(await readFile(recordingPath(name), "utf8")) as { readonly sha256?: string };
  } catch {
    return undefined;
  }
};

const main = async (): Promise<void> => {
  const send = process.argv.includes("--send");
  const identified = process.argv.includes("--identified");
  const asked = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const names = (identified ? [...FOREIGN_BUYER_CASES] : (Object.keys(BUILD_CASES) as BuildCase[])).filter((n) => asked.length === 0 || asked.includes(n));
  const anaf = buildDeps({}).anaf;
  for (const [index, name] of names.entries()) {
    const xml = builtCase(name, identified);
    const file = identified ? `${name}.identified` : name;
    const sha256 = sha256Of(Buffer.from(xml, "utf8"));
    const before = await recorded(file);
    if (!send) {
      console.log(`${file}: ${sha256.slice(0, 12)} ${before?.sha256 === sha256 ? "matches its recording" : "NOT RECORDED for these bytes"}`);
      continue;
    }
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, GAP_MS));
    const answer = await anaf.validate(xml, "FACT1");
    const verdict = verdictOf(answer);
    await mkdir(dirname(recordingPath(file)), { recursive: true });
    await writeFile(
      recordingPath(file),
      `${JSON.stringify(
        { case: file, recordedOn: new Date().toISOString().slice(0, 10), endpoint: `${ANAF_PUBLIC.fctel}/validare/FACT1`, sha256, bytes: Buffer.byteLength(xml), answer },
        null,
        2,
      )}\n`,
    );
    console.log(`${file}: ${sha256.slice(0, 12)} ${verdict.valid ? "valid" : `NOT VALID ${JSON.stringify(verdict)}`}`);
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
