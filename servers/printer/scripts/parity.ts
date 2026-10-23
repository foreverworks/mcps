/**
 * Parity with a reference implementation of the correction, from its outputs:
 * the tables it computed for a calibration, and the raster it wrote for a
 * document. Reads files only; prints nothing.
 *
 *   npx tsx scripts/parity.ts --calibration cal.json --luts luts.bin [--edges edges.json]
 *   npx tsx scripts/parity.ts --calibration cal.json --pwg ours.pwg --reference theirs.pwg
 *
 * `luts.bin` is every band's 256-entry table, band after band (420 x 256 bytes
 * for A4 at 600 dpi in 0.5 mm bands). The tables are held to within one grey
 * level (the requirement) and the count of entries that differ at all is
 * reported; two rasters are compared page by page, pixel by pixel.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { parseCalibration } from "../src/domain/correction/calibration.js";
import { buildLuts } from "../src/domain/correction/luts.js";
import { fitModel } from "../src/domain/correction/model.js";
import { decodeDocument } from "../src/domain/pwg.js";

const { values } = parseArgs({
  options: { calibration: { type: "string" }, luts: { type: "string" }, edges: { type: "string" }, pwg: { type: "string" }, reference: { type: "string" } },
});

let failed = false;
const report = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? "ok" : "FAIL"} ${what}`);
  if (!ok) failed = true;
};

if (values.calibration !== undefined && values.luts !== undefined) {
  const parsed = parseCalibration(readFileSync(values.calibration, "utf8"));
  if (!parsed.ok) throw new Error(parsed.problems.join("; "));
  const luts = buildLuts(fitModel(parsed.calibration.points), { widthPx: 4960, dpi: 600 });
  const want = readFileSync(values.luts);
  report(want.length === luts.tables.length * 256, `${luts.tables.length} bands here, ${want.length / 256} in the reference`);
  let worst = 0;
  let differing = 0;
  luts.tables.forEach((table, band) =>
    table.forEach((v, i) => {
      const d = Math.abs(v - (want[band * 256 + i] ?? -999));
      worst = Math.max(worst, d);
      if (d > 0) differing += 1;
    }),
  );
  report(worst <= 1, `tables within one grey level: worst ${worst}, ${differing} of ${luts.tables.length * 256} entries differ`);
  if (values.edges !== undefined) report(JSON.stringify(JSON.parse(readFileSync(values.edges, "utf8"))) === JSON.stringify(luts.edges), "band edges are the reference's");
}

if (values.pwg !== undefined && values.reference !== undefined) {
  const ours = decodeDocument(readFileSync(values.pwg));
  const theirs = decodeDocument(readFileSync(values.reference));
  report(ours.length === theirs.length, `${ours.length} page(s) here, ${theirs.length} in the reference`);
  ours.forEach((page, i) => {
    const other = theirs[i];
    const same = other !== undefined && page.width === other.width && page.height === other.height && Buffer.from(page.pixels).equals(Buffer.from(other.pixels));
    let differing = 0;
    if (!same && other !== undefined && page.pixels.length === other.pixels.length) page.pixels.forEach((v, k) => (differing += v === other.pixels[k] ? 0 : 1));
    report(same, `page ${i + 1}: ${page.width} x ${page.height}, ${same ? "every pixel the same" : `${differing} pixels differ`}`);
  });
  report(readFileSync(values.pwg).equals(readFileSync(values.reference)), "the files are byte-identical");
}

if (failed) process.exit(1);
