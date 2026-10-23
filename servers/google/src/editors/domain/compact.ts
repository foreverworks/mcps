/**
 * An API's styles as a model reads them: a Dimension as "12pt", a colour as
 * "#rrggbb", and nothing empty. The API's JSON repeats every default on every
 * run and cell; this is what makes a structural read affordable. Writes take
 * the API's own shapes, which the tool descriptions say. Pure.
 */

type Json = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

const CHANNELS = ["red", "green", "blue"] as const;

const hexOf = (rgb: Json): string =>
  `#${CHANNELS.map((c) => Math.round(Math.min(1, Math.max(0, typeof rgb[c] === "number" ? (rgb[c] as number) : 0)) * 255).toString(16).padStart(2, "0")).join("")}`;

/** Sheets' and Slides' bare colour: only channels, every one a number. */
const isBareColor = (value: Json, keys: readonly string[]): boolean =>
  keys.length > 0 && keys.every((k) => (k === "alpha" || (CHANNELS as readonly string[]).includes(k)) && typeof value[k] === "number");

export const compact = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const items = value.map(compact).filter((v) => v !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (!isObject(value)) return value;
  const keys = Object.keys(value);
  // A Dimension: Docs' and Slides' lengths.
  if (keys.includes("unit") && keys.every((k) => k === "unit" || k === "magnitude")) {
    const magnitude = typeof value.magnitude === "number" ? value.magnitude : 0;
    return value.unit === "PT" ? `${magnitude}pt` : `${magnitude} ${String(value.unit)}`;
  }
  if (isBareColor(value, keys)) return hexOf(value);
  // Docs' Color and OptionalColor; Sheets' and Slides' ColorStyle with an rgbColor.
  if (keys.length === 1 && isObject(value.rgbColor)) return hexOf(value.rgbColor);
  if (keys.length === 1 && isObject(value.color) && isObject(value.color.rgbColor)) return hexOf(value.color.rgbColor);
  const entries = keys.map((k) => [k, compact(value[k])] as const).filter(([, v]) => v !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
};
