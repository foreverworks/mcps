/**
 * Live smoke test: drives the server as a real MCP client would, against the
 * configured printer. By default it only reads and prepares: nothing is
 * printed or scanned.
 *
 *   npm run build -w @foreverworks/mcp-printer
 *   PRINTER_URI=... PRINTER_TLS_SHA256=... MCP_FILE_ROOTS=<dir> SMOKE_FILE=<file in it> npx tsx scripts/smoke.ts
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<token file> SMOKE_FILE=<file in its inbox> npx tsx scripts/smoke.ts
 *
 * status (the printer must answer, idle or printing, accepting jobs; the
 * scanner must answer); calibration; a dry run of SMOKE_FILE when it is set
 * (a PWG raster that decodes to whole A4 pages, and a preview of each). With
 * --print it then prints SMOKE_FILE once, and with --scan scans the glass
 * once: both use paper or the scanner in someone's home, so pass them only
 * when the person there expects it.
 */
import { readFileSync } from "node:fs";

import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

import { decodeDocument } from "../src/domain/pwg.js";

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? "ok" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const main = async (): Promise<void> => {
  const client = await connectSmoke({ name: "smoke" });
  const call = async (name: string, args: Record<string, unknown> = {}) => toolJson(await client.callTool({ name, arguments: args }));
  const file = process.env["SMOKE_FILE"]?.trim();

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));
  const status = await call("status");
  console.log("status:", JSON.stringify(status));
  check(status.printer?.ok === true && ["idle", "processing"].includes(status.printer.state), `the printer answers (${status.printer?.state ?? status.printer?.error?.kind})`);
  check(status.printer?.accepting_jobs !== false, "the printer accepts jobs");
  check(status.scanner?.ok === true, `the scanner answers (${status.scanner?.state ?? status.scanner?.error?.kind})`);
  const calibration = await call("calibration");
  console.log("calibration:", JSON.stringify({ loaded: calibration.loaded, points: calibration.points, sheets: calibration.sheets }));

  if (file) {
    const dry = await call("print", { file: { path: file }, dry_run: true });
    console.log("dry run:", JSON.stringify({ ...dry, pages: dry.pages?.length }));
    check(dry.dry_run === true && dry.printed === false, "a dry run prints nothing");
    if (dry.pwg?.path) {
      try {
        const pages = decodeDocument(readFileSync(dry.pwg.path));
        check(pages.length === dry.sheets && pages.every((p) => p.width === 4960 && p.height === 7015), `its raster decodes to ${pages.length} A4 page(s) at 600 dpi`);
      } catch (cause) {
        check(false, `its raster can be read here (${String(cause)})`);
      }
    }
    if (process.argv.includes("--print")) {
      const printed = await call("print", { file: { path: file } });
      console.log("print:", JSON.stringify(printed));
      check(printed.printed === true, `printed: job ${printed.job?.job_id} ${printed.job?.state}`);
    }
  }
  if (process.argv.includes("--scan")) {
    const scanned = await call("scan", { resolution: 300, format: "pdf" });
    console.log("scan:", JSON.stringify(scanned));
    check(typeof scanned.path === "string" && scanned.size > 0, `scanned to ${scanned.path}`);
  }

  await client.close();
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nsmoke: every check passed");
};

main().catch((error: unknown) => {
  console.error("smoke failed:", error);
  process.exit(1);
});
