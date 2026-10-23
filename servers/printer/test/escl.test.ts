/**
 * eSCL documents as a real multifunction serves them (identifiers replaced),
 * and the JPEG trim for scanners that send bytes after the image.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SCAN_SIZES, scanRequestProblem, scanSettingsXml, scannerCapabilitiesOf, scannerStatusOf, trimJpeg } from "../src/domain/escl.js";

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("eSCL", () => {
  it("reads the scanner's capabilities: the glass, colours, formats, resolutions and intents", () => {
    const caps = scannerCapabilitiesOf(fixture("escl-capabilities.xml"));
    expect(caps).toEqual({
      ok: true,
      value: {
        makeAndModel: "Example MFP 100",
        version: "2.63",
        platen: {
          maxWidth: 2550,
          maxHeight: 3508,
          colorModes: ["Grayscale8", "RGB24"],
          formats: ["image/jpeg", "application/pdf", "application/octet-stream"],
          resolutions: [75, 150, 300],
          intents: ["Document", "TextAndGraphic", "Photo", "Preview"],
        },
      },
    });
  });

  it("reads the scanner's state and its recent jobs", () => {
    const status = scannerStatusOf(fixture("escl-status.xml"));
    expect(status.ok && status.value.state).toBe("Idle");
    expect(status.ok && status.value.jobs[1]).toEqual({
      uri: "/eSCL/ScanJobs/00000000-0000-4000-8000-000000000002",
      state: "Completed",
      imagesCompleted: 1,
      ageSeconds: 60,
      reasons: ["JobCompletedSuccessfully"],
    });
    expect(scannerStatusOf("<html>no</html>")).toEqual({ ok: false, problem: "no ScannerStatus element" });
  });

  it("asks for a platen scan in the scanner's own units, and checks it against what the scanner offers", () => {
    const request = { resolution: 300, colorMode: "Grayscale8" as const, format: "application/pdf" as const, ...SCAN_SIZES.a4, intent: "Document" };
    const xml = scanSettingsXml(request, "2.63");
    for (const part of ["<pwg:Width>2480</pwg:Width>", "<pwg:Height>3508</pwg:Height>", "<pwg:InputSource>Platen</pwg:InputSource>", "<scan:XResolution>300</scan:XResolution>", "escl:ThreeHundredthsOfInches"]) {
      expect(xml).toContain(part);
    }
    const caps = scannerCapabilitiesOf(fixture("escl-capabilities.xml"));
    const platen = caps.ok ? caps.value.platen : undefined;
    if (platen === undefined) throw new Error("no platen");
    expect(scanRequestProblem(request, platen)).toBeUndefined();
    expect(scanRequestProblem({ ...request, resolution: 600 }, platen)).toBe("the scanner scans at 75, 150, 300 dpi, not 600");
    expect(scanRequestProblem({ ...request, height: 4000 }, platen)).toMatch(/glass is 2550 x 3508/);
  });

  it("trims a JPEG at its end-of-image marker, past stuffed bytes, restart markers and an embedded thumbnail", () => {
    const segment = (marker: number, body: number[]) => [0xff, marker, ((body.length + 2) >> 8) & 0xff, (body.length + 2) & 0xff, ...body];
    const thumbnail = [0xff, 0xd8, 0xff, 0xd9];
    const image = [0xff, 0xd8, ...segment(0xe1, [0x45, 0x78, ...thumbnail]), ...segment(0xda, [1, 2, 3]), 0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33, 0xff, 0xd9];
    const junk = [0xff, 0xd9, 0x00, 0x42, 0x42];
    expect([...trimJpeg(Uint8Array.from([...image, ...junk]))]).toEqual(image);
    expect([...trimJpeg(Uint8Array.from(image))]).toEqual(image);
    const notJpeg = Uint8Array.from([0x25, 0x50, 0x44, 0x46]);
    expect(trimJpeg(notJpeg)).toBe(notJpeg);
  });
});
