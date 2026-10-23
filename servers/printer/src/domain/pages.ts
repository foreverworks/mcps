/**
 * A document's pages, and how each is rendered for the sheet. Pure.
 */

/** One PDF page as the renderer will draw it: its size in points after its own rotation. */
export type PdfPage = { readonly page: number; readonly widthPt: number; readonly heightPt: number };

/**
 * pdfinfo's per-page lines (`pdfinfo -f 1 -l N`):
 *
 *     Page    1 size: 595.276 x 841.89 pts (A4)
 *     Page    1 rot:  90
 *
 * A page turned a quarter is drawn with its sides swapped.
 */
export const pdfPagesOf = (text: string): readonly PdfPage[] => {
  const sizes = new Map<number, [number, number]>();
  const rotations = new Map<number, number>();
  for (const line of text.split("\n")) {
    const size = /^Page\s+(\d+)\s+size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/.exec(line);
    if (size) sizes.set(Number(size[1]), [Number(size[2]), Number(size[3])]);
    const rot = /^Page\s+(\d+)\s+rot:\s+(-?\d+)/.exec(line);
    if (rot) rotations.set(Number(rot[1]), ((Number(rot[2]) % 360) + 360) % 360);
  }
  return [...sizes]
    .toSorted(([a], [b]) => a - b)
    .map(([page, [w, h]]) => {
      const quarter = (rotations.get(page) ?? 0) % 180 === 90;
      return { page, widthPt: quarter ? h : w, heightPt: quarter ? w : h };
    });
};

/** pdfinfo's `Pages:` line. */
export const pageCountOf = (text: string): number | undefined => {
  const m = /^Pages:\s+(\d+)/m.exec(text);
  return m ? Number(m[1]) : undefined;
};

export type PageRange = { readonly ok: true; readonly pages: readonly number[] } | { readonly ok: false; readonly problem: string };

/** "1-3,5" against a document of `count` pages: the pages in the order given; undefined or blank is every page. */
export const pageRange = (spec: string | undefined, count: number): PageRange => {
  if (spec === undefined || spec.trim() === "") return { ok: true, pages: Array.from({ length: count }, (_, i) => i + 1) };
  const pages: number[] = [];
  for (const part of spec.split(",").map((p) => p.trim())) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part);
    if (!m) return { ok: false, problem: `"${part}" is not a page or a range like 2-4` };
    const first = Number(m[1]);
    const last = m[2] === undefined ? first : Number(m[2]);
    if (first < 1 || last < first) return { ok: false, problem: `"${part}" is not a range of pages` };
    if (last > count) return { ok: false, problem: `the document has ${count} page${count === 1 ? "" : "s"}; "${part}" goes past it` };
    for (let p = first; p <= last; p += 1) pages.push(p);
  }
  return { ok: true, pages };
};

export type RenderPlan = {
  readonly dpi: number;
  /** A landscape page is rendered as it is and turned a quarter onto the portrait sheet. */
  readonly rotate: boolean;
};

/**
 * How to render a page onto a portrait sheet of `sheetPt` at `dpi`: a page
 * the size of the sheet (or smaller) at the sheet's resolution, so it prints
 * at its true size; a larger one at the lower resolution that fits it, so the
 * renderer draws its text and lines at the size they will print instead of a
 * raster being shrunk afterwards. Landscape pages are turned.
 */
export const renderPlan = (page: PdfPage, sheetPt: readonly [number, number], dpi: number): RenderPlan => {
  const rotate = page.widthPt > page.heightPt && sheetPt[0] < sheetPt[1];
  const [w, h] = rotate ? [page.heightPt, page.widthPt] : [page.widthPt, page.heightPt];
  const scale = Math.min(1, sheetPt[0] / w, sheetPt[1] / h);
  // a page within a point of the sheet is the sheet: render it at the sheet's resolution, and crop
  const nearSheet = Math.abs(w - sheetPt[0]) <= 1 && Math.abs(h - sheetPt[1]) <= 1;
  return { dpi: nearSheet ? dpi : Math.floor(dpi * scale * 1000) / 1000, rotate };
};

/** A4 in PostScript points. */
export const A4_PT: readonly [number, number] = [(210 / 25.4) * 72, (297 / 25.4) * 72];

/** What kind of document the bytes are, by their signature. */
export const documentKind = (bytes: Uint8Array): "pdf" | "png" | "jpeg" | undefined => {
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "pdf";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  return undefined;
};
