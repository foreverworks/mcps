import type { GreyPage } from "./pwg.js";

/**
 * Grey rasters and how a page is laid on the sheet. Pure: pixels in, pixels
 * out. 255 is paper white, 0 black, rows top to bottom.
 */

export type Size = { readonly width: number; readonly height: number };

/** A4 at a resolution, rounded down as a printer counts whole dots: 4960 x 7015 at 600 dpi. */
export const a4At = (dpi: number): Size => ({ width: Math.floor((210 / 25.4) * dpi), height: Math.floor((297 / 25.4) * dpi) });

/**
 * A raster this close to the page in both directions is the page itself,
 * rendered with a rounding of its own (pdftoppm makes A4 at 600 dpi
 * 4961 x 7016): it is cropped or padded, never resampled, so text and fine
 * lines keep their exact pixels.
 */
export const NEAR_PAGE_PX = 4;

export const isNearPage = (image: Size, page: Size): boolean =>
  Math.abs(image.width - page.width) <= NEAR_PAGE_PX && Math.abs(image.height - page.height) <= NEAR_PAGE_PX;

/** A blank sheet. */
export const blank = (size: Size): GreyPage => ({ ...size, pixels: new Uint8Array(size.width * size.height).fill(255) });

/** `image` copied onto `page` with its top-left corner at (left, top); whatever falls outside the page is cut off. */
export const placeAt = (image: GreyPage, page: Size, left: number, top: number): GreyPage => {
  const out = blank(page);
  const x0 = Math.max(0, left);
  const x1 = Math.min(page.width, left + image.width);
  for (let y = Math.max(0, top); y < Math.min(page.height, top + image.height); y += 1) {
    const from = (y - top) * image.width + (x0 - left);
    out.pixels.set(image.pixels.subarray(from, from + (x1 - x0)), y * page.width + x0);
  }
  return out;
};

/** Centred on the page; an image a pixel or two larger is cut evenly. */
export const centre = (image: GreyPage, page: Size): GreyPage =>
  placeAt(image, page, Math.floor((page.width - image.width) / 2), Math.floor((page.height - image.height) / 2));

/** A quarter turn counter-clockwise: a landscape page's top goes to the sheet's left edge. */
export const rotateLeft = (image: GreyPage): GreyPage => {
  const { width, height, pixels } = image;
  const out = new Uint8Array(width * height);
  // the output is `height` wide and `width` tall: (x, y) -> (y, width - 1 - x)
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) out[(width - 1 - x) * height + y] = pixels[row + x] as number;
  }
  return { width: height, height: width, pixels: out };
};

/** The largest size with the image's proportions that fits in `box`. */
export const fitInside = (image: Size, box: Size): Size => {
  const scale = Math.min(box.width / image.width, box.height / image.height);
  return { width: Math.max(1, Math.min(box.width, Math.round(image.width * scale))), height: Math.max(1, Math.min(box.height, Math.round(image.height * scale))) };
};

/** Weights of the source pixels each target pixel covers, along one axis: area averaging. */
const coverage = (source: number, target: number): readonly { readonly first: number; readonly weights: Float64Array }[] => {
  const step = source / target;
  return Array.from({ length: target }, (_, i) => {
    const a = i * step;
    const b = Math.min(source, (i + 1) * step);
    const first = Math.floor(a);
    const last = Math.min(source - 1, Math.ceil(b) - 1);
    const weights = new Float64Array(last - first + 1);
    for (let k = first; k <= last; k += 1) weights[k - first] = (Math.min(b, k + 1) - Math.max(a, k)) / step;
    return { first, weights };
  });
};

/**
 * Resampled to `size`: area-averaged when it shrinks (every source pixel
 * counts once, so fine detail turns to the grey it averages to rather than
 * aliasing), nearest-neighbour when it grows (at printer resolutions a
 * duplicated pixel is invisible, and edges stay sharp).
 */
export const resize = (image: GreyPage, size: Size): GreyPage => {
  if (size.width === image.width && size.height === image.height) return image;
  if (size.width > image.width || size.height > image.height) {
    const out = new Uint8Array(size.width * size.height);
    const xs = Array.from({ length: size.width }, (_, x) => Math.min(image.width - 1, Math.floor(((x + 0.5) * image.width) / size.width)));
    for (let y = 0; y < size.height; y += 1) {
      const sy = Math.min(image.height - 1, Math.floor(((y + 0.5) * image.height) / size.height));
      const src = sy * image.width;
      const dst = y * size.width;
      for (let x = 0; x < size.width; x += 1) out[dst + x] = image.pixels[src + (xs[x] as number)] as number;
    }
    return { ...size, pixels: out };
  }
  const cols = coverage(image.width, size.width);
  const rows = coverage(image.height, size.height);
  const horizontal = new Float64Array(size.width * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const src = y * image.width;
    for (let x = 0; x < size.width; x += 1) {
      const { first, weights } = cols[x] as (typeof cols)[number];
      let sum = 0;
      for (let k = 0; k < weights.length; k += 1) sum += (weights[k] as number) * (image.pixels[src + first + k] as number);
      horizontal[y * size.width + x] = sum;
    }
  }
  const out = new Uint8Array(size.width * size.height);
  for (let y = 0; y < size.height; y += 1) {
    const { first, weights } = rows[y] as (typeof rows)[number];
    for (let x = 0; x < size.width; x += 1) {
      let sum = 0;
      for (let k = 0; k < weights.length; k += 1) sum += (weights[k] as number) * (horizontal[(first + k) * size.width + x] as number);
      out[y * size.width + x] = Math.min(255, Math.max(0, Math.round(sum)));
    }
  }
  return { ...size, pixels: out };
};

/** How a raster was put on the sheet, for the result. */
export type Placement = "as_rendered" | "cropped" | "centred" | "fitted";

/**
 * A PDF page rendered for the sheet: near the page, cropped or padded from
 * the top-left; smaller (the page was smaller, or was rendered smaller to fit),
 * centred.
 */
export const placeRendered = (image: GreyPage, page: Size): { readonly page: GreyPage; readonly placement: Placement } => {
  if (image.width === page.width && image.height === page.height) return { page: image, placement: "as_rendered" };
  if (isNearPage(image, page)) return { page: placeAt(image, page, 0, 0), placement: "cropped" };
  return { page: centre(image, page), placement: "centred" };
};

/**
 * An image for the sheet. An image has no size on paper of its own, so it is
 * fitted to the page (turned a quarter if it is landscape), unless it already
 * is the page at this resolution, which is cropped like a rendered PDF page.
 */
export const placeImage = (image: GreyPage, page: Size): { readonly page: GreyPage; readonly placement: Placement; readonly rotated: boolean } => {
  if (isNearPage(image, page)) return { page: placeAt(image, page, 0, 0), placement: "cropped", rotated: false };
  const rotated = image.width > image.height && page.width < page.height;
  const upright = rotated ? rotateLeft(image) : image;
  return { page: centre(resize(upright, fitInside(upright, page)), page), placement: "fitted", rotated };
};

/** A small copy for a person to look at: every `factor` x `factor` block averaged. */
export const preview = (page: GreyPage, factor: number): GreyPage =>
  resize(page, { width: Math.max(1, Math.floor(page.width / factor)), height: Math.max(1, Math.floor(page.height / factor)) });

/** A binary PGM (P5, maxval 255), as pdftoppm -gray writes it. Throws a RangeError for anything else. */
export const parsePgm = (data: Uint8Array): GreyPage => {
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const fields: string[] = [];
  let p = 0;
  while (fields.length < 4) {
    while (p < buf.length && /\s/.test(String.fromCharCode(buf[p] as number))) p += 1;
    if (buf[p] === 0x23) {
      while (p < buf.length && buf[p] !== 0x0a) p += 1;
      continue;
    }
    const start = p;
    while (p < buf.length && !/\s/.test(String.fromCharCode(buf[p] as number))) p += 1;
    if (start === p) throw new RangeError("not a PGM: the header ends early");
    fields.push(buf.subarray(start, p).toString("ascii"));
  }
  p += 1; // the single whitespace before the pixels
  const [magic, w, h, max] = fields as [string, string, string, string];
  if (magic !== "P5") throw new RangeError(`not a binary PGM (${magic.slice(0, 8)})`);
  const width = Number(w);
  const height = Number(h);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) throw new RangeError("a PGM with no size");
  if (max !== "255") throw new RangeError(`a PGM with maxval ${max}; only 8-bit is read`);
  if (buf.length - p < width * height) throw new RangeError(`a PGM cut short: ${buf.length - p} of ${width * height} pixels`);
  return { width, height, pixels: new Uint8Array(buf.subarray(p, p + width * height)) };
};

/**
 * Colour to grey as ITU-R 601 luma, the weights every image library uses
 * (299, 587, 114 per mille); transparency is laid over white paper.
 */
export const greyFromRgba = (rgba: Uint8Array, size: Size): GreyPage => {
  const pixels = new Uint8Array(size.width * size.height);
  for (let i = 0; i < pixels.length; i += 1) {
    const a = (rgba[i * 4 + 3] as number) / 255;
    const over = (v: number): number => v * a + 255 * (1 - a);
    const luma = 0.299 * over(rgba[i * 4] as number) + 0.587 * over(rgba[i * 4 + 1] as number) + 0.114 * over(rgba[i * 4 + 2] as number);
    pixels[i] = Math.min(255, Math.max(0, Math.round(luma)));
  }
  return { ...size, pixels };
};
