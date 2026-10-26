/**
 * The icon set: one tile per server, and one per product for a server that
 * serves several (google), drawn here and written as files beside each
 * package, so every client, registry and bundle shows the same picture.
 *
 * The system, so a new icon fits the others: a rounded square tile (32 units,
 * corners 8) in one blue that holds on light and dark backgrounds alike, and a
 * glyph in near-white on a 24-unit grid inset by 4, drawn as 2-unit strokes
 * with round ends and joins, a solid shape only where a stroke would blur at
 * 16 pixels. Glyphs are generic objects (an envelope, a receipt, a globe):
 * never a vendor's logo, which is theirs and changes without notice.
 *
 * Each package gets, in icons/:
 *   icon.svg, icon-48.png    the server's icon; the PNG is what it announces
 *                            at initialize (MCP serverInfo), as a data: URI
 *   icon-512.png             for the registry entry and the desktop bundle
 *   <product>.svg, <product>-32.png
 *                            a product's icon, on each of its tools in tools/list
 *
 * PNGs are rendered from the SVG (rsvg-convert) and optimised without loss
 * (optipng; a reduced palette would lose the anti-aliased corners): about 450
 * bytes at 32 pixels, which every tool of a product repeats. MCP clients must show PNG; SVG is
 * only a "should", so the server announces PNG. Run after changing a glyph:
 *
 *   npx tsx scripts/icons.ts
 *
 * check-docs holds each SVG to this file, so a glyph changed here and not
 * written fails the check.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The tile's blue and the glyph's near-white; the site takes its accent from the tile. */
export const TILE = "#2F4F86";
export const INK = "#F4F6FA";

type Glyph = { readonly d: string; readonly fill?: string };

/** Each server's glyph, by its folder under servers/. */
export const GLYPHS: Readonly<Record<string, Glyph>> = {
  "anaf-efactura": { d: "M6 3.5h8.5l4 4v13H6z M14.5 3.5v4h4 M9 13.5l2.2 2.2 4-4.2" },
  "anaf-spv": { d: "M4 13.5 6.5 5h11l2.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z M4 13.5h4.5l1 2.2h5l1-2.2H20" },
  "app-stores": { d: "M5.5 4.5h13A1.5 1.5 0 0 1 20 6v9.5a1.5 1.5 0 0 1-1.5 1.5H11l-4 3.5V17H5.5A1.5 1.5 0 0 1 4 15.5V6a1.5 1.5 0 0 1 1.5-1.5z", fill: "M12 7.2l1.15 2.35 2.6.38-1.88 1.83.44 2.58L12 13.12l-2.31 1.22.44-2.58-1.88-1.83 2.6-.38z" },
  bitwarden: { d: "M11.2 12.8a4 4 0 1 1-5.66 5.66 4 4 0 0 1 5.66-5.66z M11.2 12.8 19.5 4.5 M16.5 7.5l2.5 2.5 M14 10l2 2" },
  bnr: { d: "M5 8.5h13.5 M15 5l3.5 3.5L15 12 M19 15.5H5.5 M9 12l-3.5 3.5L9 19" },
  "bolt-food": { d: "M4 11.5h16a8 8 0 0 1-16 0z M9 3.5c-1 1.2 1 2.6 0 4 M13 3.5c-1 1.2 1 2.6 0 4 M9.5 20.5h5" },
  devices: { d: "M8.5 3h7A1.5 1.5 0 0 1 17 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-7A1.5 1.5 0 0 1 7 19.5v-15A1.5 1.5 0 0 1 8.5 3z M11 17.5h2" },
  eas: { d: "M12 3l8 4.5v9L12 21l-8-4.5v-9z M4 7.5l8 4.5 8-4.5 M12 12v9" },
  "enable-banking": { d: "M4 9.5 12 5l8 4.5z M6.5 12.5v4.5 M10.5 12.5v4.5 M13.5 12.5v4.5 M17.5 12.5v4.5 M4 20h16" },
  glovo: { d: "M5.5 8.5h13l-1 12h-11z M9 8.5V7a3 3 0 0 1 6 0v1.5" },
  google: { d: "M5.5 4h4A1.5 1.5 0 0 1 11 5.5v4A1.5 1.5 0 0 1 9.5 11h-4A1.5 1.5 0 0 1 4 9.5v-4A1.5 1.5 0 0 1 5.5 4z M14.5 4h4A1.5 1.5 0 0 1 20 5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 13 9.5v-4A1.5 1.5 0 0 1 14.5 4z M5.5 13h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 9.5 20h-4A1.5 1.5 0 0 1 4 18.5v-4A1.5 1.5 0 0 1 5.5 13z M14.5 13h4a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-4a1.5 1.5 0 0 1 1.5-1.5z" },
  notion: { d: "M6.5 3.5h11A1.5 1.5 0 0 1 19 5v14a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19V5a1.5 1.5 0 0 1 1.5-1.5z M8.5 12h7 M8.5 15.5h4.5", fill: "M8 6.5h8v3H8z" },
  oblio: { d: "M6 3.5h12v17l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5-2 1.5z M9 8h6 M9 11.5h6 M12.5 15h2.5" },
  onrc: { d: "M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5z M12 6.5v13" },
  porkbun: { d: "M20.5 12a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0z M3.5 12h17 M12 3.5c-2.5 2.3-3.8 5.2-3.8 8.5s1.3 6.2 3.8 8.5c2.5-2.3 3.8-5.2 3.8-8.5S14.5 5.8 12 3.5z" },
  printer: { d: "M7 9V4h10v5 M7 17H5.5A1.5 1.5 0 0 1 4 15.5v-5A1.5 1.5 0 0 1 5.5 9h13a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H17 M7 13.5h10V20H7z" },
  "smart-home": { d: "M3.5 11.5 12 4.5l8.5 7 M6 9.5V20h12V9.5 M9.2 14.2a4 4 0 0 1 5.6 0 M10.6 16a2 2 0 0 1 2.8 0", fill: "M13 18.2a1 1 0 1 1-2 0 1 1 0 0 1 2 0z" },
  trademarks: { d: "M16.5 10.5a6 6 0 1 1-12 0 6 6 0 0 1 12 0z M15 15l5 5" },
  typesafe: { d: "M4 16a8 8 0 0 1 16 0 M12 16l4.5-4.5 M4 20h16" },
};

/** Each product's glyph, for the servers that serve several. */
export const PRODUCTS: Readonly<Record<string, Readonly<Record<string, Glyph>>>> = {
  google: {
    gmail: { d: "M5 5.5h14A1.5 1.5 0 0 1 20.5 7v10a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17V7A1.5 1.5 0 0 1 5 5.5z M4 7l8 6 8-6" },
    calendar: { d: "M5.5 5.5h13A1.5 1.5 0 0 1 20 7v11.5a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5V7a1.5 1.5 0 0 1 1.5-1.5z M4 10h16 M8.5 3.5v4 M15.5 3.5v4", fill: "M13.5 13.5h3v3h-3z" },
    drive: { d: "M4.5 6h4.5l2 2h8.5A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5v-10A1.5 1.5 0 0 1 4.5 6z" },
    docs: { d: "M6 3.5h8.5l4 4v13H6z M14.5 3.5v4h4 M9 11.5h6 M9 14.5h6 M9 17.5h4" },
    sheets: { d: "M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z M4 9.5h16 M4 14.5h16 M10 4v16" },
    slides: { d: "M5 4.5h14A1.5 1.5 0 0 1 20.5 6v8.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5V6A1.5 1.5 0 0 1 5 4.5z M12 16v4 M8.5 20h7 M7.5 9h5 M7.5 12h8" },
    tasks: { d: "M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z M8 12.5l3 3 5-6" },
    contacts: { d: "M15.5 8.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z M5 20c.8-3.8 3.6-6 7-6s6.2 2.2 7 6" },
    meet: { d: "M5 7h8.5A1.5 1.5 0 0 1 15 8.5v7a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 5 7z M15 10.5l5.5-3v9l-5.5-3z" },
  },
};

/** The repository's own mark (the site's favicon and wordmark): two units of a rack. */
export const SITE_GLYPH: Glyph = {
  d: "M5.5 4h13A1.5 1.5 0 0 1 20 5.5v3A1.5 1.5 0 0 1 18.5 10h-13A1.5 1.5 0 0 1 4 8.5v-3A1.5 1.5 0 0 1 5.5 4z M5.5 14h13a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-3A1.5 1.5 0 0 1 5.5 14z",
  fill: "M7 6h2.5v2H7z M7 16h2.5v2H7z",
};

/** An icon's SVG: the tile, then the glyph. */
export const iconSvg = (glyph: Glyph): string =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">`,
    `<rect width="32" height="32" rx="8" fill="${TILE}"/>`,
    `<g transform="translate(4 4)">`,
    `<path d="${glyph.d}" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    glyph.fill === undefined ? "" : `<path d="${glyph.fill}" fill="${INK}"/>`,
    `</g></svg>\n`,
  ].join("");

/** Where a server's icon files go. */
export const iconsDir = (server: string): string => join(ROOT, "servers", server, "icons");

const png = (svg: string, size: number, out: string): void => {
  execFileSync("rsvg-convert", ["-w", String(size), "-h", String(size), svg, "-o", out]);
  execFileSync("optipng", ["-quiet", "-o5", "-strip", "all", out]);
};

const write = (dir: string, name: string, glyph: Glyph, sizes: readonly number[]): void => {
  const svg = join(dir, `${name}.svg`);
  writeFileSync(svg, iconSvg(glyph));
  for (const size of sizes) png(svg, size, join(dir, `${name}-${size}.png`));
};

const main = (): void => {
  for (const [server, glyph] of Object.entries(GLYPHS)) {
    const dir = iconsDir(server);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    write(dir, "icon", glyph, [48, 512]);
    for (const [product, own] of Object.entries(PRODUCTS[server] ?? {})) write(dir, product, own, [32]);
    console.log(`servers/${server}/icons`);
  }
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
