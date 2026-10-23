import { fail, inputError } from "./errors.js";
import type { CellFormatOut, ColorOut, GridRangeOut, SheetsRequest } from "./schema.js";

/** What format_range can set. Everything is optional; at least one thing must be given. */
export type FormatSpec = {
  readonly numberFormat?: { readonly type: string; readonly pattern?: string };
  readonly bold?: boolean;
  readonly italic?: boolean;
  /** "#RRGGBB". */
  readonly background?: string;
  readonly foreground?: string;
  readonly horizontalAlignment?: string;
  readonly verticalAlignment?: string;
  readonly wrap?: string;
  readonly borders?: { readonly style: string; readonly color?: string; readonly sides: readonly string[] };
  readonly freezeRows?: number;
  readonly freezeColumns?: number;
};

/** "#1a73e8" as Google's 0-1 floats. Colours are not money; a float is what the API takes. */
export const colour = (hex: string): ColorOut => {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return fail(inputError(`"${hex}" is not a #RRGGBB colour`));
  const [, r = "0", g = "0", b = "0"] = m;
  return { red: parseInt(r, 16) / 255, green: parseInt(g, 16) / 255, blue: parseInt(b, 16) / 255 };
};

/** The cell format and the field mask naming exactly what it sets, so nothing else about the cells changes. */
const cellFormat = (spec: FormatSpec): { readonly format: CellFormatOut; readonly fields: readonly string[] } => {
  const text = {
    ...(spec.bold === undefined ? {} : { bold: spec.bold }),
    ...(spec.italic === undefined ? {} : { italic: spec.italic }),
    ...(spec.foreground === undefined ? {} : { foregroundColorStyle: { rgbColor: colour(spec.foreground) } }),
  };
  const format: CellFormatOut = {
    ...(spec.numberFormat ? { numberFormat: { ...spec.numberFormat } } : {}),
    ...(Object.keys(text).length ? { textFormat: text } : {}),
    ...(spec.background === undefined ? {} : { backgroundColorStyle: { rgbColor: colour(spec.background) } }),
    ...(spec.horizontalAlignment ? { horizontalAlignment: spec.horizontalAlignment } : {}),
    ...(spec.verticalAlignment ? { verticalAlignment: spec.verticalAlignment } : {}),
    ...(spec.wrap ? { wrapStrategy: spec.wrap } : {}),
  };
  const fields = [
    ...(format.numberFormat ? ["numberFormat"] : []),
    ...Object.keys(text).map((k) => `textFormat.${k}`),
    ...(format.backgroundColorStyle ? ["backgroundColorStyle"] : []),
    ...(format.horizontalAlignment ? ["horizontalAlignment"] : []),
    ...(format.verticalAlignment ? ["verticalAlignment"] : []),
    ...(format.wrapStrategy ? ["wrapStrategy"] : []),
  ].map((f) => `userEnteredFormat.${f}`);
  return { format, fields };
};

const SIDES: Readonly<Record<string, readonly string[]>> = {
  all: ["top", "bottom", "left", "right", "innerHorizontal", "innerVertical"],
  outer: ["top", "bottom", "left", "right"],
  inner: ["innerHorizontal", "innerVertical"],
  top: ["top"],
  bottom: ["bottom"],
  left: ["left"],
  right: ["right"],
};

const bordersRequest = (range: GridRangeOut, borders: NonNullable<FormatSpec["borders"]>): SheetsRequest => {
  const border = { style: borders.style, ...(borders.color ? { colorStyle: { rgbColor: colour(borders.color) } } : {}) };
  const sides = [...new Set(borders.sides.flatMap((s) => SIDES[s] ?? fail(inputError(`"${s}" is not a border side (${Object.keys(SIDES).join(", ")})`))))];
  return { updateBorders: { range, ...Object.fromEntries(sides.map((s) => [s, border])) } };
};

/**
 * The requests for one format_range call: the cell formats as one repeatCell,
 * the borders as one updateBorders, the frozen rows and columns as one
 * updateSheetProperties. Nothing given is refused rather than sent as a no-op.
 */
export const formatRequests = (range: GridRangeOut, spec: FormatSpec): readonly SheetsRequest[] => {
  const { format, fields } = cellFormat(spec);
  const frozen = {
    ...(spec.freezeRows === undefined ? {} : { frozenRowCount: spec.freezeRows }),
    ...(spec.freezeColumns === undefined ? {} : { frozenColumnCount: spec.freezeColumns }),
  };
  const requests: readonly SheetsRequest[] = [
    ...(fields.length ? [{ repeatCell: { range, cell: { userEnteredFormat: format }, fields: fields.join(",") } }] : []),
    ...(spec.borders ? [bordersRequest(range, spec.borders)] : []),
    ...(Object.keys(frozen).length
      ? [
          {
            updateSheetProperties: {
              properties: { sheetId: range.sheetId ?? 0, gridProperties: frozen },
              fields: Object.keys(frozen).map((k) => `gridProperties.${k}`).join(","),
            },
          },
        ]
      : []),
  ];
  return requests.length ? requests : fail(inputError("nothing to format: give a number format, a style, a colour, an alignment, borders or frozen rows"));
};
