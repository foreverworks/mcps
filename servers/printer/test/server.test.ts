/**
 * The server as a client sees it, through the kit's guard, against a fake
 * device: an IPP printer and an eSCL scanner answering as the real ones do
 * (a job that is processing before it completes, a scan that is not ready on
 * the first ask, a Location naming another host, a JPEG with bytes after its
 * end). Images are decoded for real; a PDF is rendered by poppler when it is
 * installed.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkPolicy, connectInMemory, guard, McpServer, REQUIRES_USER_META } from "@foreverworks/mcp-kit";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { buildDeps } from "../src/composition.js";
import { parseCalibration } from "../src/domain/correction/calibration.js";
import { buildLuts } from "../src/domain/correction/luts.js";
import { fitModel } from "../src/domain/correction/model.js";
import { decodeMessage, encodeRequest, enumValue, GROUP, integer, keyword, type OutAttribute, TAG } from "../src/domain/ipp/codec.js";
import { decodeDocument } from "../src/domain/pwg.js";
import type { DeviceFetch } from "../src/infra/device.js";
import { sheetLayout } from "../src/domain/correction/sheet.js";
import { POLICY } from "../src/mcp/policy.js";
import { registerAll } from "../src/mcp/register.js";
import { printedOf, scanned } from "./scans.js";

const fixture = (name: string): Buffer => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

const ippAnswer = (status: number, requestId: number, groups: { tag: number; attributes: OutAttribute[] }[]): Uint8Array =>
  new Uint8Array(
    encodeRequest({
      operation: status,
      requestId,
      groups: [
        {
          tag: GROUP.operation,
          attributes: [
            { name: "attributes-charset", values: [{ tag: TAG.charset, value: "utf-8" }] },
            { name: "attributes-natural-language", values: [{ tag: TAG.naturalLanguage, value: "en" }] },
          ],
        },
        ...groups,
      ],
    }),
  );

const JPEG_WITH_JUNK = Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0x11, 0x22, 0xff, 0xd9, 0x00, 0x00, 0x13]);

type Device = {
  printerState: number;
  scannerState: string;
  printed: Uint8Array[];
  ipp: number[];
  escl: string[];
  jobPolls: number;
  scanAsks: number;
  pollsFail?: boolean;
};

const fakeDevice = (device: Device): DeviceFetch => async (url, init) => {
  const body = init.body === undefined ? new Uint8Array() : init.body instanceof Blob ? new Uint8Array(await init.body.arrayBuffer()) : typeof init.body === "string" ? Buffer.from(init.body) : init.body;
  if (url.pathname === "/ipp/print") {
    const request = decodeMessage(body);
    device.ipp.push(request.code);
    if (request.code === 0x0009 && device.pollsFail === true) return new Response("busy", { status: 503 });
    const job = (state: number, id = 7) => ({ tag: GROUP.job, attributes: [{ name: "job-id", values: [integer(id)] }, { name: "job-state", values: [enumValue(state)] }] });
    const answer = (() => {
      switch (request.code) {
        case 0x000b:
          return ippAnswer(0, request.requestId, [
            {
              tag: GROUP.printer,
              attributes: [
                { name: "printer-state", values: [enumValue(device.printerState)] },
                { name: "printer-state-reasons", values: [keyword(device.printerState === 5 ? "media-empty-error" : "none")] },
                { name: "printer-is-accepting-jobs", values: [{ tag: TAG.boolean, value: device.printerState !== 5 }] },
                { name: "marker-names", values: [{ tag: TAG.name, value: "Black" }] },
                { name: "marker-levels", values: [integer(80)] },
              ],
            },
          ]);
        case 0x0002:
          device.printed.push(request.data);
          return ippAnswer(0, request.requestId, [job(3)]);
        case 0x0009:
          device.jobPolls += 1;
          return ippAnswer(0, request.requestId, [job(device.jobPolls < 2 ? 5 : 9)]);
        case 0x0008:
          return ippAnswer(0, request.requestId, []);
        case 0x000a:
          return ippAnswer(0, request.requestId, [job(9, 5), job(9, 6)]);
        default:
          return ippAnswer(0x0501, request.requestId, []);
      }
    })();
    return new Response(answer, { status: 200, headers: { "content-type": "application/ipp" } });
  }
  device.escl.push(`${init.method} ${url.pathname}`);
  if (url.pathname === "/eSCL/ScannerCapabilities") return new Response(fixture("escl-capabilities.xml"), { status: 200 });
  if (url.pathname === "/eSCL/ScannerStatus") return new Response(fixture("escl-status.xml").toString().replace("<pwg:State>Idle", `<pwg:State>${device.scannerState}`), { status: 200 });
  if (url.pathname === "/eSCL/ScanJobs" && init.method === "POST") return new Response(null, { status: 201, headers: { location: "http://somewhere.else:80/eSCL/ScanJobs/abc" } });
  if (url.pathname === "/eSCL/ScanJobs/abc/NextDocument") {
    device.scanAsks += 1;
    return device.scanAsks === 1 ? new Response(null, { status: 503 }) : new Response(JPEG_WITH_JUNK, { status: 200, headers: { "content-type": "image/jpeg" } });
  }
  return new Response("not here", { status: 404 });
};

const png = (width: number, height: number, grey: number): Buffer => {
  const image = new PNG({ width, height });
  image.data.fill(grey);
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
  return PNG.sync.write(image);
};

const connected = async (env: Record<string, string> = {}) => {
  const root = mkdtempSync(join(tmpdir(), "printer-test-"));
  const inbox = join(root, "inbox");
  execFileSync("mkdir", ["-p", inbox]);
  const device: Device = { printerState: 3, scannerState: "Idle", printed: [], ipp: [], escl: [], jobPolls: 0, scanAsks: 0 };
  const deps = buildDeps({
    env: { PRINTER_URI: "ipps://printer.example:443/ipp/print", PRINTER_TLS_SHA256: "ab".repeat(32), PRINTER_STATE_DIR: join(root, "state"), MCP_FILE_ROOTS: inbox, ...env },
    fetch: fakeDevice(device),
    sleep: async () => undefined,
  });
  const server = new McpServer({ name: "printer", version: "test" });
  registerAll(guard(server, { service: "printer", policy: POLICY, log: () => undefined }), deps);
  const client = await connectInMemory(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const result = (await client.callTool({ name, arguments: args })) as { content: { text: string }[] };
    return JSON.parse(result.content[0]?.text ?? "{}");
  };
  const put = (name: string, bytes: Buffer): string => {
    writeFileSync(join(inbox, name), bytes);
    return name;
  };
  return { call, client, device, put, root };
};

const hasPoppler = (() => {
  try {
    execFileSync("pdftoppm", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

/** A one-page A4 PDF with a 50% grey square, written object by object with a correct xref. */
const squarePdf = (): Buffer => {
  const content = "0.5 g 72 72 144 144 re f\n";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.276 841.89] /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}endstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = objects.map((body, i) => {
    const at = text.length;
    text += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text, "latin1");
};

describe("the tool surface", () => {
  it("lists the same tools, arguments and descriptions as the snapshot, every one classified", async () => {
    const s = await connected({ MCP_FILE_ROOTS: "/srv/printer/inbox" });
    const { tools } = await s.client.listTools();
    await expect(`${JSON.stringify(tools, null, 2)}\n`).toMatchFileSnapshot("./tools.snapshot.json");
    expect(() => checkPolicy("printer", (server) => registerAll(server, buildDeps({ env: {} })), POLICY)).not.toThrow();
  });

  it("marks print and scan for the user to approve every call, and nothing else", async () => {
    const s = await connected();
    const { tools } = await s.client.listTools();
    const marked = tools.filter((t) => t._meta?.[REQUIRES_USER_META] === true).map((t) => t.name);
    expect(marked).toEqual(["calibration_sheet", "print", "scan"]);
    expect(tools.map((t) => t.name)).toContain("health");
    expect(tools.find((t) => t.name === "print")?.annotations?.readOnlyHint).toBe(false);
    expect(tools.find((t) => t.name === "status")?.annotations?.readOnlyHint).toBe(true);
  });
});

describe("status", () => {
  it("reports the printer, the scanner and the calibration, each for itself", async () => {
    const s = await connected();
    const status = await s.call("status");
    expect(status.printer).toMatchObject({ ok: true, state: "idle", reasons: [], accepting_jobs: true, supplies: [{ name: "Black", level_percent: 80 }] });
    expect(status.scanner).toMatchObject({ ok: true, state: "Idle" });
    expect(status.calibration).toMatchObject({ loaded: false });
  });

  it("is healthy with the printer off, and not with a certificate that is not the pinned one", async () => {
    const s = await connected();
    expect(await s.call("health")).toEqual({ ok: true, printer: { reachable: true, state: "idle" }, scanner: { reachable: true, state: "Idle" }, calibration: { loaded: false, path: expect.any(String) } });
    const off = await connected({ PRINTER_TLS_SHA256: "zz" });
    expect(await off.call("health")).toMatchObject({ ok: false, problems: [expect.stringContaining("config"), expect.stringContaining("config")] });
  });

  it("names the missing address, and still prepares a print without a device", async () => {
    const s = await connected({ PRINTER_URI: "" });
    const status = await s.call("status");
    expect(status.printer).toMatchObject({ ok: false, error: { kind: "config", variable: "PRINTER_URI" } });
    expect(status.scanner).toMatchObject({ ok: false, error: { kind: "config" } });
    const dry = await s.call("print", { file: { path: s.put("page.png", png(30, 40, 128)) }, dry_run: true });
    expect(dry).toMatchObject({ dry_run: true, printed: false, correction: "off" });
  });
});

describe("print", () => {
  it("prepares an image without printing: fitted to A4, turned when landscape, with a preview, nothing sent", async () => {
    const s = await connected();
    const dry = await s.call("print", { file: { path: s.put("wide.png", png(300, 200, 0)) }, dry_run: true });
    expect(dry).toMatchObject({ dry_run: true, sheets: 1, correction: "off", pages: [{ page: 1, placement: "fitted", rotated: true }] });
    const [page] = decodeDocument(readFileSync(dry.pwg.path));
    expect([page?.width, page?.height]).toEqual([4960, 7015]);
    expect(page?.pixels[3507 * 4960 + 2480]).toBe(0);
    expect(readFileSync(dry.previews[0].path).subarray(1, 4).toString()).toBe("PNG");
    expect(s.device.ipp).toEqual([]);
  });

  it("corrects with the loaded calibration, each band through its own table", async () => {
    const s = await connected();
    const loaded = await s.call("load_calibration", { file: { path: s.put("calibration.json", fixture("calibration.json")) } });
    expect(loaded).toMatchObject({ loaded: true, points: 156, from: { name: "calibration.json" } });
    expect(loaded.tone_response).toHaveLength(11);
    const dry = await s.call("print", { file: { path: s.put("grey.png", png(4960, 7015, 128)) }, dry_run: true });
    expect(dry).toMatchObject({ correction: "on", calibration_points: 156, pages: [{ placement: "cropped" }] });
    const [page] = decodeDocument(readFileSync(dry.pwg.path));
    const parsed = parseCalibration(fixture("calibration.json").toString());
    if (!parsed.ok) throw new Error("fixture");
    const luts = buildLuts(fitModel(parsed.calibration.points), { widthPx: 4960, dpi: 600 });
    expect(page?.pixels[100 * 4960 + 5]).toBe(luts.tables[0]?.[128]);
    expect(page?.pixels[100 * 4960 + 2480]).toBe(luts.tables[210]?.[128]);
    expect((await s.call("print", { file: { path: "grey.png" }, dry_run: true, correction: false })).correction).toBe("off");
    expect((await s.call("calibration")).sheets.map((x: { sheet: string }) => x.sheet)).toEqual(["S1", "S2", "S3"]);
  }, 60_000);

  it("prints: the copies as pages in one lossless raster, then waits for the job to finish", async () => {
    const s = await connected();
    const printed = await s.call("print", { file: { path: s.put("p.png", png(50, 70, 200)) }, copies: 2 });
    expect(printed).toMatchObject({ printed: true, finished: true, sheets: 2, job: { job_id: 7, state: "completed" } });
    expect(s.device.ipp).toEqual([0x000b, 0x0002, 0x0009, 0x0009]);
    const pages = decodeDocument(s.device.printed[0] ?? new Uint8Array());
    expect(pages.map((p) => [p.width, p.height, p.totalPages])).toEqual([
      [4960, 7015, 2],
      [4960, 7015, 2],
    ]);
  });

  it("keeps the job's number when it loses sight of the job, so nobody prints it twice", async () => {
    const s = await connected();
    s.device.pollsFail = true;
    const printed = await s.call("print", { file: { path: s.put("p.png", png(10, 10, 0)) } });
    expect(printed).toMatchObject({ printed: false, finished: false, job: { job_id: 7, state: "pending" }, note: expect.stringContaining("before printing again") });
  });

  it("refuses to send when the printer is stopped, saying why", async () => {
    const s = await connected();
    s.device.printerState = 5;
    const refused = await s.call("print", { file: { path: s.put("p.png", png(10, 10, 0)) } });
    expect(refused.error).toMatchObject({ kind: "busy", device: "printer", message: expect.stringContaining("no paper in the tray") });
    expect(s.device.ipp).toEqual([0x000b]);
  });

  it("refuses what it cannot print before reading anything else", async () => {
    const s = await connected();
    expect((await s.call("print", { file: { path: s.put("x.gif", Buffer.from("GIF89a....")) } })).error).toMatchObject({ kind: "input", message: expect.stringContaining("not a PDF, PNG or JPEG") });
    expect((await s.call("print", { file: { path: s.put("y.png", png(5, 5, 0)) }, correction: true })).error).toMatchObject({ kind: "calibration" });
    expect((await s.call("print", { file: { path: "../outside.png" } })).error).toMatchObject({ kind: "input" });
  });

  it.skipIf(!hasPoppler)("renders an A4 PDF at 600 dpi, cropped to the sheet, its grey as drawn", async () => {
    const s = await connected();
    const dry = await s.call("print", { file: { path: s.put("square.pdf", squarePdf()) }, dry_run: true });
    expect(dry).toMatchObject({ pages: [{ page: 1, placement: "cropped", rendered_dpi: 600, source: { width: 4961, height: 7016 } }] });
    const [page] = decodeDocument(readFileSync(dry.pwg.path));
    // the square spans 72..216 pt from the left and bottom: (1200, 5800) is inside, (100, 100) outside
    expect(Math.abs((page?.pixels[5800 * 4960 + 1200] ?? 0) - 128)).toBeLessThanOrEqual(1);
    expect(page?.pixels[100 * 4960 + 100]).toBe(255);
    expect((await s.call("print", { file: { path: "square.pdf" }, pages: "2", dry_run: true })).error).toMatchObject({ kind: "input" });
  });
});

describe("calibrating", () => {
  const greyPng = (page: { width: number; height: number; pixels: Uint8Array }): Buffer => {
    const image = new PNG({ width: page.width, height: page.height });
    for (let i = 0; i < page.pixels.length; i += 1) {
      const v = page.pixels[i] as number;
      image.data[i * 4] = v;
      image.data[i * 4 + 1] = v;
      image.data[i * 4 + 2] = v;
      image.data[i * 4 + 3] = 255;
    }
    return PNG.sync.write(image);
  };

  it("prints the sheet uncorrected, then measures its scan into the calibration", async () => {
    const s = await connected();
    const dry = await s.call("calibration_sheet", { sheet: "cal-a", dry_run: true });
    expect(dry).toMatchObject({ dry_run: true, sheet: "cal-a", patches: 342, correction: "off" });
    const printed = await s.call("calibration_sheet", { sheet: "cal-a" });
    expect(printed).toMatchObject({ printed: true, sheet: "cal-a", next: expect.stringContaining('measure_calibration with sheet "cal-a"') });
    const [page] = decodeDocument(s.device.printed[0] ?? new Uint8Array());
    expect(page?.pixels[Math.round((12 / 25.4) * 600) * 4960 + Math.round((12 / 25.4) * 600)]).toBe(0);

    const scan = s.put("cal-a.png", greyPng(scanned(sheetLayout("cal-a"), { dpi: 150, angle: 0.4, shift: [2, 1], turned: false })));
    const checked = await s.call("measure_calibration", { sheet: "cal-a", file: { path: scan }, add: false });
    expect(checked).toMatchObject({ added: false, measured: { points: 342, page_turned: false, error_before: null }, points: 342 });
    expect((await s.call("calibration")).loaded).toBe(false);
    const added = await s.call("measure_calibration", { sheet: "cal-a", file: { path: scan } });
    expect(added).toMatchObject({ added: true, points: 342, sheets: [{ sheet: "cal-a", points: 342 }] });
    expect(added.measured.error_after).toBeLessThan(1.5);
    // the model's split between tone and profile is its own; their sum is the printer's
    const mid = added.tone_response.find((r: { sent: number }) => r.sent === 50).printed;
    const centre = added.lateral_profile_at_mid_tones.find((r: { x_mm: number }) => r.x_mm === 105).offset;
    expect(Math.abs(mid + centre - printedOf(50, 105))).toBeLessThan(1.5);
    expect((await s.call("measure_calibration", { sheet: "cal-a", file: { path: scan } })).error).toMatchObject({ kind: "input", message: expect.stringContaining("replace: true") });
    expect((await s.call("calibration_sheet", { sheet: "cal-a", dry_run: true })).error).toMatchObject({ kind: "input" });
    expect((await s.call("measure_calibration", { sheet: "cal-a", scan: "/etc/passwd" })).error).toMatchObject({ kind: "input" });
  }, 120_000);
});

describe("jobs", () => {
  it("lists jobs, reads one, and cancels one", async () => {
    const s = await connected();
    expect((await s.call("job", {})).completed.map((j: { job_id: number }) => j.job_id)).toEqual([5, 6]);
    expect((await s.call("cancel_job", { job_id: 7 })).cancelled).toBe(7);
  });
});

describe("scan", () => {
  it("scans to the outbox, waits for the document, ignores the host the scanner names, trims trailing bytes", async () => {
    const s = await connected();
    const scanned = await s.call("scan", { resolution: 150, color: "colour", format: "jpeg" });
    expect(scanned).toMatchObject({ format: "jpeg", resolution: 150, intent: "Photo", area: "a4", size: 10, trailing_bytes_removed: 3 });
    expect(readFileSync(scanned.path).equals(JPEG_WITH_JUNK.subarray(0, 10))).toBe(true);
    expect(s.device.escl).toEqual(["GET /eSCL/ScannerCapabilities", "GET /eSCL/ScannerStatus", "POST /eSCL/ScanJobs", "GET /eSCL/ScanJobs/abc/NextDocument", "GET /eSCL/ScanJobs/abc/NextDocument"]);
  });

  it("refuses what the scanner cannot do, and a scanner that is busy, before anything moves", async () => {
    const s = await connected();
    expect((await s.call("scan", { resolution: 600 })).error).toMatchObject({ kind: "input", message: "the scanner scans at 75, 150, 300 dpi, not 600" });
    s.device.scannerState = "Processing";
    expect((await s.call("scan", {})).error).toMatchObject({ kind: "busy", device: "scanner" });
    expect(s.device.escl.filter((e) => e.startsWith("POST"))).toEqual([]);
  });
});
