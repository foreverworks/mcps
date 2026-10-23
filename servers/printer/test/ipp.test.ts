/**
 * IPP encoding held to the reference client's bytes (test/fixtures/
 * print-job.request.bin: the Print-Job request the validated scripts sent,
 * for an invented printer), and decoding held to a response assembled here
 * value by value, with every syntax a printer answers in, a collection inside
 * a collection among them.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { decodeMessage, encodeRequest, GROUP, TAG } from "../src/domain/ipp/codec.js";
import { getJobAttributes, jobStatusOf, printerStatusOf, printJob, reasonOf, statusMessage, statusName, succeeded } from "../src/domain/ipp/operations.js";

const fixture = (name: string): Buffer => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

const value = (tag: number, name: string, bytes: Buffer): Buffer => {
  const n = Buffer.from(name);
  const head = Buffer.alloc(3);
  head.writeUInt8(tag, 0);
  head.writeUInt16BE(n.length, 1);
  const len = Buffer.alloc(2);
  len.writeUInt16BE(bytes.length);
  return Buffer.concat([head, n, len, bytes]);
};
const text = (tag: number, name: string, s: string): Buffer => value(tag, name, Buffer.from(s));
const int32 = (tag: number, name: string, n: number): Buffer => {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return value(tag, name, b);
};

/** A Get-Printer-Attributes answer as a printer sends it. */
const response = (): Buffer =>
  Buffer.concat([
    Buffer.from([2, 0, 0, 0, 0, 0, 0, 7]),
    Buffer.from([GROUP.operation]),
    text(TAG.charset, "attributes-charset", "utf-8"),
    text(TAG.naturalLanguage, "attributes-natural-language", "en"),
    Buffer.from([GROUP.printer]),
    int32(TAG.enum, "printer-state", 5),
    text(TAG.keyword, "printer-state-reasons", "media-empty-error"),
    text(TAG.keyword, "", "toner-low-report"),
    text(TAG.keyword, "", "vendor-thing"),
    value(TAG.boolean, "printer-is-accepting-jobs", Buffer.from([0])),
    int32(TAG.integer, "queued-job-count", 2),
    text(TAG.text, "printer-make-and-model", "Example MFP 100"),
    text(TAG.name, "printer-firmware-name", "Main"),
    text(TAG.text, "printer-firmware-string-version", "1.02"),
    value(TAG.textWithLanguage, "printer-state-message", Buffer.concat([Buffer.from([0, 2]), Buffer.from("en"), Buffer.from([0, 9]), Buffer.from("Load A4  ")])),
    value(TAG.resolution, "pwg-raster-document-resolution-supported", Buffer.from([0, 0, 2, 0x58, 0, 0, 2, 0x58, 3])),
    value(TAG.rangeOfInteger, "copies-supported", Buffer.from([0, 0, 0, 1, 0, 0, 3, 0xe7])),
    value(TAG.dateTime, "printer-current-time", Buffer.from([0x07, 0xd0, 1, 1, 0, 0, 0, 0, 0x2b, 0, 0])),
    text(TAG.name, "marker-names", "Black"),
    text(TAG.name, "", "Drum"),
    text(TAG.keyword, "marker-types", "toner"),
    text(TAG.keyword, "", "opc"),
    int32(TAG.integer, "marker-levels", 97),
    int32(TAG.integer, "", -3),
    int32(TAG.integer, "marker-low-levels", 7),
    int32(TAG.integer, "", 10),
    int32(TAG.integer, "marker-high-levels", 100),
    int32(TAG.integer, "", 100),
    // media-col-ready = { media-size = { x-dimension 21000, y-dimension 29700 }, media-source "auto" }
    value(TAG.begCollection, "media-col-ready", Buffer.alloc(0)),
    text(TAG.memberAttrName, "", "media-size"),
    value(TAG.begCollection, "", Buffer.alloc(0)),
    text(TAG.memberAttrName, "", "x-dimension"),
    int32(TAG.integer, "", 21000),
    text(TAG.memberAttrName, "", "y-dimension"),
    int32(TAG.integer, "", 29700),
    value(TAG.endCollection, "", Buffer.alloc(0)),
    text(TAG.memberAttrName, "", "media-source"),
    text(TAG.keyword, "", "auto"),
    value(TAG.endCollection, "", Buffer.alloc(0)),
    text(TAG.keyword, "media-ready", "iso_a4_210x297mm"),
    value(TAG.octetString, "printer-alert", Buffer.from("code=other")),
    Buffer.from([GROUP.end]),
  ]);

describe("IPP requests", () => {
  it("encode Print-Job byte for byte as the reference client did", () => {
    const request = printJob("ipps://printer.example:443/ipp/print", { jobName: "test page", documentFormat: "image/pwg-raster" });
    expect(encodeRequest({ ...request, requestId: 1 }).equals(fixture("print-job.request.bin"))).toBe(true);
  });

  it("carry a user name only when one is given, and read back as they were written", () => {
    const named = decodeMessage(encodeRequest({ ...printJob("ipp://p/ipp/print", { jobName: "j", documentFormat: "x/y", userName: "ana" }), requestId: 9 }));
    expect(named.requestId).toBe(9);
    expect(named.code).toBe(0x0002);
    expect(named.groups[0]?.attributes.get("requesting-user-name")).toEqual([{ tag: "string", syntax: TAG.name, value: "ana" }]);
    const job = decodeMessage(encodeRequest({ ...getJobAttributes("ipp://p/ipp/print", 42), requestId: 3 }));
    expect(job.groups[0]?.attributes.get("job-id")).toEqual([{ tag: "integer", value: 42 }]);
    expect(job.groups[0]?.attributes.get("requested-attributes")?.length).toBeGreaterThan(3);
  });
});

describe("IPP responses", () => {
  const message = decodeMessage(response());

  it("decode every value syntax, additional values and nested collections", () => {
    const printer = message.groups.find((g) => g.tag === GROUP.printer)?.attributes;
    expect(printer?.get("printer-state-reasons")?.map((v) => (v.tag === "string" ? v.value : ""))).toEqual(["media-empty-error", "toner-low-report", "vendor-thing"]);
    expect(printer?.get("pwg-raster-document-resolution-supported")).toEqual([{ tag: "resolution", x: 600, y: 600, units: "dpi" }]);
    expect(printer?.get("copies-supported")).toEqual([{ tag: "range", lower: 1, upper: 999 }]);
    expect(printer?.get("printer-current-time")).toEqual([{ tag: "dateTime", value: "2000-01-01T00:00:00.0+00:00" }]);
    expect(printer?.get("printer-state-message")).toEqual([{ tag: "string", syntax: TAG.textWithLanguage, value: "Load A4  " }]);
    const col = printer?.get("media-col-ready")?.[0];
    expect(col?.tag).toBe("collection");
    const size = col?.tag === "collection" ? col.members.get("media-size")?.[0] : undefined;
    expect(size?.tag === "collection" ? size.members.get("y-dimension") : undefined).toEqual([{ tag: "integer", value: 29700 }]);
    expect(printer?.get("media-ready")).toEqual([{ tag: "string", syntax: TAG.keyword, value: "iso_a4_210x297mm" }]);
    expect(succeeded(message)).toBe(true);
  });

  it("map to the printer's status in plain words", () => {
    expect(printerStatusOf(message)).toEqual({
      state: "stopped",
      reasons: [
        { reason: "media-empty", severity: "error", meaning: "no paper in the tray" },
        { reason: "toner-low", severity: "report", meaning: "toner is low" },
        { reason: "vendor-thing" },
      ],
      message: "Load A4  ",
      acceptingJobs: false,
      queuedJobs: 2,
      makeAndModel: "Example MFP 100",
      firmware: [{ name: "Main", version: "1.02" }],
      mediaReady: ["iso_a4_210x297mm"],
      supplies: [
        { name: "Black", type: "toner", levelPercent: 97, lowAtPercent: 7 },
        { name: "Drum", type: "opc", level: "some-remaining", lowAtPercent: 10 },
      ],
      documentFormats: [],
      pwgRasterTypes: [],
      pwgRasterDpi: [600],
    });
  });

  it("name a refusal by its status keyword and message", () => {
    const refused = decodeMessage(
      Buffer.concat([Buffer.from([2, 0, 0x04, 0x0a, 0, 0, 0, 1, GROUP.operation]), text(TAG.text, "status-message", "format not supported"), Buffer.from([GROUP.end])]),
    );
    expect(succeeded(refused)).toBe(false);
    expect(statusName(refused.code)).toBe("client-error-document-format-not-supported");
    expect(statusMessage(refused)).toBe("format not supported");
    expect(() => decodeMessage(Buffer.from([2, 0, 0, 0, 0, 0, 0, 1, 1, 0x47, 0, 5]))).toThrow(RangeError);
  });

  it("read a job's state and reasons", () => {
    const attrs = new Map([
      ["job-id", [{ tag: "integer" as const, value: 12 }]],
      ["job-state", [{ tag: "enum" as const, value: 9 }]],
      ["job-state-reasons", [{ tag: "string" as const, syntax: TAG.keyword, value: "job-completed-successfully" }]],
      ["job-impressions-completed", [{ tag: "integer" as const, value: 3 }]],
    ]);
    expect(jobStatusOf(attrs)).toEqual({ jobId: 12, state: "completed", reasons: [{ reason: "job-completed-successfully" }], pagesCompleted: 3 });
    expect(reasonOf("cover-open-warning")).toEqual({ reason: "cover-open", severity: "warning", meaning: "a cover is open" });
  });
});
