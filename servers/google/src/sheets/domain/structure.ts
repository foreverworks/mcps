import { compact } from "../../editors/domain/compact.js";
import { columnLetter, quoteSheet } from "./a1.js";
import type { RawGridRange, RawSheet, RawSpreadsheet } from "./schema.js";

/**
 * A spreadsheet's structure with every id a request needs: each sheet's id and
 * size, its merges, conditional formats, filters, protected and banded ranges,
 * charts, slicers, tables and groups, and the named ranges. Ranges read as A1
 * ("'Sheet 1'!A1:C10"), which batch_update_spreadsheet takes back where a
 * GridRange goes. No cell data: that is get_values' or read_rows'. Pure.
 */

type Json = Readonly<Record<string, unknown>>;
type Out = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** Each sheet's title and size by id, so a GridRange reads as A1. */
export type Titles = ReadonlyMap<number, { readonly title: string; readonly rows: number; readonly columns: number }>;

export const titlesOf = (raw: RawSpreadsheet): Titles =>
  new Map(
    (raw.sheets ?? []).map((s) => {
      const p = s.properties ?? {};
      return [p.sheetId ?? 0, { title: p.title ?? "", rows: p.gridProperties?.rowCount ?? 0, columns: p.gridProperties?.columnCount ?? 0 }] as const;
    }),
  );

/**
 * A GridRange as A1: 0-based, end-exclusive indices to 1-based, inclusive
 * cells. Whole columns read "A:C", whole rows "3:5", a range with no bounds
 * the sheet's quoted title alone, and an open end the sheet's last row or
 * column.
 */
export const gridToA1 = (range: RawGridRange | null | undefined, titles: Titles): string => {
  const sheet = titles.get(range?.sheetId ?? 0);
  const title = quoteSheet(sheet?.title ?? `sheet ${range?.sheetId ?? 0}`);
  const { startRowIndex: r0, endRowIndex: r1, startColumnIndex: c0, endColumnIndex: c1 } = range ?? {};
  const hasRows = r0 != null || r1 != null;
  const hasColumns = c0 != null || c1 != null;
  const lastRow = r1 ?? sheet?.rows ?? (r0 ?? 0) + 1;
  const lastColumn = (c1 ?? sheet?.columns ?? (c0 ?? 0) + 1) - 1;
  if (!hasRows && !hasColumns) return title;
  if (!hasRows) return `${title}!${columnLetter(c0 ?? 0)}:${columnLetter(lastColumn)}`;
  if (!hasColumns) return `${title}!${(r0 ?? 0) + 1}:${lastRow}`;
  const from = `${columnLetter(c0 ?? 0)}${(r0 ?? 0) + 1}`;
  const to = `${columnLetter(lastColumn)}${lastRow}`;
  return from === to ? `${title}!${from}` : `${title}!${from}:${to}`;
};

const dimensionToA1 = (range: Json | undefined, titles: Titles): string | undefined => {
  if (!range) return undefined;
  const sheetId = typeof range.sheetId === "number" ? range.sheetId : 0;
  const start = typeof range.startIndex === "number" ? range.startIndex : 0;
  const end = typeof range.endIndex === "number" ? range.endIndex : undefined;
  return range.dimension === "COLUMNS"
    ? gridToA1({ sheetId, startColumnIndex: start, ...(end === undefined ? {} : { endColumnIndex: end }) }, titles)
    : gridToA1({ sheetId, startRowIndex: start, ...(end === undefined ? {} : { endRowIndex: end }) }, titles);
};

const with_ = <K extends string>(key: K, value: unknown): Partial<Record<K, unknown>> =>
  value === undefined || value === null || value === "" || value === false || (Array.isArray(value) && value.length === 0) ? {} : ({ [key]: value } as Record<K, unknown>);

/** A chart's kind: a basic chart's own type, or the name of the spec field that holds it. */
const chartType = (spec: Json | undefined): string | undefined => {
  if (!spec) return undefined;
  const basic = spec.basicChart;
  if (isObject(basic) && typeof basic.chartType === "string") return basic.chartType;
  return Object.keys(spec).find((k) => k.endsWith("Chart"));
};

const anchorOf = (position: Json | undefined, titles: Titles): string | undefined => {
  if (!position) return undefined;
  if (typeof position.sheetId === "number") return `own sheet ${position.sheetId}`;
  if (position.newSheet) return "new sheet";
  const anchor = isObject(position.overlayPosition) && isObject(position.overlayPosition.anchorCell) ? position.overlayPosition.anchorCell : undefined;
  if (!anchor) return undefined;
  const row = typeof anchor.rowIndex === "number" ? anchor.rowIndex : 0;
  const column = typeof anchor.columnIndex === "number" ? anchor.columnIndex : 0;
  return gridToA1({ sheetId: typeof anchor.sheetId === "number" ? anchor.sheetId : 0, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: column, endColumnIndex: column + 1 }, titles);
};

const sheetOut = (sheet: RawSheet, titles: Titles): Out => {
  const p = sheet.properties ?? {};
  const grid = p.gridProperties ?? {};
  const a1 = (r: RawGridRange | null | undefined) => gridToA1(r, titles);
  return {
    sheetId: p.sheetId ?? 0,
    title: p.title ?? "",
    index: p.index ?? 0,
    ...(p.sheetType && p.sheetType !== "GRID" ? { sheetType: p.sheetType } : {}),
    ...with_("hidden", p.hidden),
    ...with_("rightToLeft", p.rightToLeft),
    ...with_("tabColor", compact(p.tabColorStyle ?? p.tabColor)),
    rows: grid.rowCount ?? 0,
    columns: grid.columnCount ?? 0,
    ...with_("frozenRows", grid.frozenRowCount),
    ...with_("frozenColumns", grid.frozenColumnCount),
    ...with_("hideGridlines", grid.hideGridlines),
    ...with_("dataSourceSheet", compact(p.dataSourceSheetProperties)),
    ...with_("merges", (sheet.merges ?? []).map(a1)),
    ...with_(
      "conditionalFormats",
      (sheet.conditionalFormats ?? []).map((rule, index) => ({
        index,
        ranges: (rule.ranges ?? []).map(a1),
        ...(rule.booleanRule ? { booleanRule: compact(rule.booleanRule) } : {}),
        ...(rule.gradientRule ? { gradientRule: compact(rule.gradientRule) } : {}),
      })),
    ),
    ...with_("basicFilter", sheet.basicFilter ? { range: a1(sheet.basicFilter.range), ...(compact({ sortSpecs: sheet.basicFilter.sortSpecs, filterSpecs: sheet.basicFilter.filterSpecs }) as Json | undefined) } : undefined),
    ...with_("filterViews", (sheet.filterViews ?? []).map((v) => ({ filterViewId: v.filterViewId, ...with_("title", v.title), range: a1(v.range) }))),
    ...with_(
      "protectedRanges",
      (sheet.protectedRanges ?? []).map((r) => ({
        protectedRangeId: r.protectedRangeId,
        ...(r.namedRangeId ? { namedRangeId: r.namedRangeId } : { range: a1(r.range) }),
        ...with_("description", r.description),
        ...with_("warningOnly", r.warningOnly),
        ...with_("unprotectedRanges", (r.unprotectedRanges ?? []).map(a1)),
        ...with_("editors", compact(r.editors)),
      })),
    ),
    ...with_("bandedRanges", (sheet.bandedRanges ?? []).map((b) => ({ bandedRangeId: b.bandedRangeId, range: a1(b.range) }))),
    ...with_(
      "charts",
      (sheet.charts ?? []).map((c) => ({
        chartId: c.chartId,
        ...with_("title", c.spec?.title),
        ...with_("type", chartType(c.spec as Json | undefined)),
        ...with_("position", anchorOf(c.position as Json | undefined, titles)),
      })),
    ),
    ...with_(
      "slicers",
      (sheet.slicers ?? []).map((s) => ({ slicerId: s.slicerId, ...with_("title", s.spec?.title), ...with_("dataRange", s.spec?.dataRange ? a1(s.spec.dataRange) : undefined) })),
    ),
    ...with_("tables", ((sheet as Json).tables as readonly Json[] | undefined ?? []).map((t) => ({ tableId: t.tableId, ...with_("name", t.name), range: a1(t.range as RawGridRange | undefined) }))),
    ...with_("rowGroups", (sheet.rowGroups ?? []).map((g) => ({ range: dimensionToA1(g.range as Json | undefined, titles), depth: g.depth, ...with_("collapsed", g.collapsed) }))),
    ...with_("columnGroups", (sheet.columnGroups ?? []).map((g) => ({ range: dimensionToA1(g.range as Json | undefined, titles), depth: g.depth, ...with_("collapsed", g.collapsed) }))),
    ...with_("developerMetadata", (sheet.developerMetadata ?? []).length || undefined),
  };
};

export const spreadsheetOutline = (raw: RawSpreadsheet): Out => {
  const titles = titlesOf(raw);
  const p = raw.properties ?? {};
  return {
    spreadsheetId: raw.spreadsheetId ?? "",
    title: p.title ?? "",
    ...with_("locale", p.locale),
    ...with_("timeZone", p.timeZone),
    ...with_("autoRecalc", p.autoRecalc && p.autoRecalc !== "ON_CHANGE" ? p.autoRecalc : undefined),
    ...with_("link", raw.spreadsheetUrl),
    sheets: (raw.sheets ?? []).map((s) => sheetOut(s, titles)),
    ...with_("namedRanges", (raw.namedRanges ?? []).map((n) => ({ namedRangeId: n.namedRangeId, name: n.name, range: gridToA1(n.range, titles) }))),
    ...with_("dataSources", compact(raw.dataSources)),
    ...with_("developerMetadata", (raw.developerMetadata ?? []).length || undefined),
  };
};
