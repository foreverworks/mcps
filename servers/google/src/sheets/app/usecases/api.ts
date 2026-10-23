import { checked, repliesOf } from "../../../editors/domain/batch.js";
import { fileIdFrom } from "../../../editors/domain/ids.js";
import { SHEETS_API } from "../../domain/api.js";
import { fail, inputError } from "../../domain/errors.js";
import { hasA1, resolveA1 } from "../../domain/refs.js";
import { gridToA1, spreadsheetOutline, titlesOf } from "../../domain/structure.js";
import { checkTyped } from "../../../editors/domain/discovery.js";
import type { RawDeveloperMetadata } from "../../domain/schema.js";
import { pickSheet, sheetSummary } from "../../domain/spreadsheet.js";
import type { CellValue, Deps, ValueReadOptions, ValueWriteOptions } from "../ports.js";

const linkOf = (id: string): string => `https://docs.google.com/spreadsheets/d/${id}/edit`;

/** DataFilters checked against the API's schema before they are sent: one of a1Range, gridRange or developerMetadataLookup each. */
const checkedFilters = (filters: readonly unknown[], path: string): readonly unknown[] => {
  const problems = checkTyped(SHEETS_API, "DataFilter", filters, path);
  if (problems.length > 0) return fail(inputError(`data filters do not match the Sheets API (revision ${SHEETS_API.revision}); nothing was sent: ${problems.join("; ")}`));
  return filters;
};

/** Exactly one of two ways to choose cells. */
const oneOf = (ranges: readonly unknown[], filters: readonly unknown[]): "ranges" | "filters" => {
  if (ranges.length > 0 && filters.length > 0) return fail(inputError("give ranges or data_filters, not both"));
  if (ranges.length === 0 && filters.length === 0) return fail(inputError("give ranges (A1) or data_filters: which cells"));
  return ranges.length > 0 ? "ranges" : "filters";
};

export type GetArgs = {
  readonly spreadsheetId: string;
  readonly format: "outline" | "raw";
  readonly ranges: readonly string[];
  readonly dataFilters: readonly unknown[];
  readonly includeGridData: boolean;
  readonly fields: string;
  readonly maxChars: number;
};

/** The structure with every id (outline), or the API's JSON narrowed by ranges and a field mask (raw). */
export const getSpreadsheet = async (deps: Deps, args: GetArgs) => {
  const id = fileIdFrom(args.spreadsheetId);
  if (args.format === "outline") {
    if (args.includeGridData || args.fields || args.dataFilters.length > 0) {
      return fail(inputError("include_grid_data, data_filters and fields are for format raw; the outline never carries cells"));
    }
    return spreadsheetOutline(await deps.sheets.get(id, {}));
  }
  if (args.ranges.length > 0 && args.dataFilters.length > 0) return fail(inputError("give ranges or data_filters, not both"));
  const raw =
    args.dataFilters.length > 0
      ? await deps.sheets.getByDataFilter(id, checkedFilters(args.dataFilters, "data_filters"), { includeGridData: args.includeGridData, ...(args.fields ? { fields: args.fields } : {}) })
      : await deps.sheets.get(id, { ranges: args.ranges, includeGridData: args.includeGridData, ...(args.fields ? { fields: args.fields } : {}) });
  const size = JSON.stringify(raw).length;
  if (size > args.maxChars) {
    return fail(
      inputError(
        `the raw spreadsheet is ${size} characters, over max_chars ${args.maxChars}: narrow it with ranges and fields ` +
          '(e.g. "sheets(properties,conditionalFormats)" or "sheets(data(rowData(values(userEnteredFormat))))"), or raise max_chars',
      ),
    );
  }
  return { spreadsheetId: id, link: linkOf(id), spreadsheet: raw };
};

/**
 * Any requests the Sheets API takes, as one batchUpdate: all apply or none do.
 * A1 is resolved to coordinates first, from one read of the sheet ids, and
 * only when a request uses it (domain/refs.ts); then the requests are checked
 * against the API's schema, and nothing is sent if one is wrong.
 */
export const batchUpdateSpreadsheet = async (deps: Deps, args: { readonly spreadsheetId: string; readonly requests: readonly unknown[] }) => {
  const id = fileIdFrom(args.spreadsheetId);
  let requests = checkedShape(args.requests);
  if (hasA1(SHEETS_API, requests)) {
    const meta = await deps.sheets.metadata(id);
    const sheets = new Map((meta.sheets ?? []).map((s) => [s.properties?.title ?? "", s.properties?.sheetId ?? 0] as const));
    requests = resolveA1(SHEETS_API, requests, sheets);
  }
  const answer = await deps.sheets.apply(id, checked(SHEETS_API, requests));
  return { spreadsheetId: answer.spreadsheetId ?? id, link: linkOf(id), applied: requests.length, replies: repliesOf(answer.replies) };
};

/** Objects, each worth walking for A1; the full check comes after A1 is resolved, so a string where a GridRange goes is not yet a problem. */
const checkedShape = (requests: readonly unknown[]) => {
  const bad = requests.findIndex((r) => typeof r !== "object" || r === null || Array.isArray(r));
  if (bad !== -1) return fail(inputError(`requests[${bad}]: expected an object holding one request, e.g. {"repeatCell": {...}}`));
  return requests as readonly Readonly<Record<string, unknown>>[];
};

export type GetValuesArgs = ValueReadOptions & {
  readonly spreadsheetId: string;
  readonly ranges: readonly string[];
  /** Instead of ranges: cells chosen by DataFilters (A1, a GridRange or developer metadata). */
  readonly dataFilters: readonly unknown[];
  readonly maxChars: number;
};

/**
 * Several ranges' values in one read. A large answer is cut at a row, never
 * mid-row, and each range cut says how many rows it kept.
 */
export const getValues = async (deps: Deps, args: GetValuesArgs) => {
  const id = fileIdFrom(args.spreadsheetId);
  const { valueRenderOption, dateTimeRenderOption, majorDimension } = args;
  const options = { valueRenderOption, dateTimeRenderOption, majorDimension };
  const read =
    oneOf(args.ranges, args.dataFilters) === "ranges"
      ? ((await deps.sheets.getValues(id, args.ranges, options)).valueRanges ?? []).map((vr) => ({ vr, filters: undefined }))
      : ((await deps.sheets.getValuesByDataFilter(id, checkedFilters(args.dataFilters, "data_filters"), options)).valueRanges ?? []).map((m) => ({
          vr: m.valueRange ?? {},
          filters: m.dataFilters,
        }));
  let budget = args.maxChars;
  let truncated = false;
  const valueRanges = read.map(({ vr, filters }) => {
    const rows = vr.values ?? [];
    const kept: (readonly unknown[])[] = [];
    for (const row of rows) {
      const size = JSON.stringify(row).length + 1;
      if (size > budget) break;
      budget -= size;
      kept.push(row);
    }
    const cut = kept.length < rows.length;
    truncated ||= cut;
    return {
      range: vr.range ?? "",
      majorDimension: vr.majorDimension ?? majorDimension,
      values: kept,
      ...(cut ? { totalRows: rows.length } : {}),
      ...(filters ? { dataFilters: filters } : {}),
    };
  });
  return { spreadsheetId: id, valueRanges, truncated };
};

export type UpdateValuesArgs = ValueWriteOptions & {
  readonly spreadsheetId: string;
  /** Each entry names its cells by an A1 range or by a DataFilter, the same way throughout. */
  readonly data: readonly { readonly range: string; readonly dataFilter?: unknown; readonly values: readonly (readonly CellValue[])[] }[];
};

export const updateValues = async (deps: Deps, args: UpdateValuesArgs) => {
  const id = fileIdFrom(args.spreadsheetId);
  const { valueInputOption, majorDimension, includeValuesInResponse } = args;
  const options = { valueInputOption, majorDimension, includeValuesInResponse };
  const byFilter = args.data.filter((d) => d.dataFilter !== undefined).length;
  if (args.data.some((d) => (d.dataFilter !== undefined) === (d.range !== ""))) return fail(inputError("each data entry names its cells once: range or data_filter"));
  if (byFilter > 0 && byFilter < args.data.length) return fail(inputError("data entries name their cells one way throughout: all by range or all by data_filter"));
  const answer =
    byFilter > 0
      ? await deps.sheets.updateValuesByDataFilter(
          id,
          args.data.map((d, n) => ({ dataFilter: checkedFilters([d.dataFilter], `data[${n}].data_filter`)[0], values: d.values })),
          options,
        )
      : await deps.sheets.updateValues(id, args.data, options);
  return {
    spreadsheetId: id,
    updatedCells: answer.totalUpdatedCells ?? 0,
    updatedRows: answer.totalUpdatedRows ?? 0,
    updatedColumns: answer.totalUpdatedColumns ?? 0,
    responses: (answer.responses ?? []).map((r) => ({
      range: r.updatedRange ?? "",
      cells: r.updatedCells ?? 0,
      ...(r.updatedData?.values ? { values: r.updatedData.values } : {}),
    })),
  };
};

export const clearValues = async (deps: Deps, args: { readonly spreadsheetId: string; readonly ranges: readonly string[]; readonly dataFilters: readonly unknown[] }) => {
  const id = fileIdFrom(args.spreadsheetId);
  const answer =
    oneOf(args.ranges, args.dataFilters) === "ranges"
      ? await deps.sheets.clearValues(id, args.ranges)
      : await deps.sheets.clearValuesByDataFilter(id, checkedFilters(args.dataFilters, "data_filters"));
  return { spreadsheetId: id, clearedRanges: answer.clearedRanges ?? [] };
};

/** Developer metadata where it is attached: the spreadsheet, a sheet, or rows or columns as A1. */
const metadataView = (m: RawDeveloperMetadata, titles: ReturnType<typeof titlesOf>) => {
  const where = m.location ?? {};
  const range = where.dimensionRange;
  const dimension =
    range && range.dimension === "COLUMNS"
      ? gridToA1({ sheetId: range.sheetId ?? 0, startColumnIndex: range.startIndex ?? 0, ...(range.endIndex == null ? {} : { endColumnIndex: range.endIndex }) }, titles)
      : range
        ? gridToA1({ sheetId: range.sheetId ?? 0, startRowIndex: range.startIndex ?? 0, ...(range.endIndex == null ? {} : { endRowIndex: range.endIndex }) }, titles)
        : undefined;
  return {
    metadataId: m.metadataId ?? null,
    key: m.metadataKey ?? "",
    ...(m.metadataValue ? { value: m.metadataValue } : {}),
    visibility: m.visibility ?? "",
    location: dimension ?? (where.sheetId != null ? `sheet ${where.sheetId} (${titles.get(where.sheetId)?.title ?? "?"})` : where.spreadsheet ? "spreadsheet" : (where.locationType ?? "")),
  };
};

/**
 * Developer metadata: key/value tags a program attaches to the spreadsheet, a
 * sheet, or rows and columns, which then name those cells in a DataFilter.
 * By id, or every tag a set of DataFilters matches.
 */
export const searchDeveloperMetadata = async (deps: Deps, args: { readonly spreadsheetId: string; readonly metadataId?: number; readonly dataFilters: readonly unknown[] }) => {
  const id = fileIdFrom(args.spreadsheetId);
  if ((args.metadataId === undefined) === (args.dataFilters.length === 0)) return fail(inputError("give metadata_id or data_filters, one of the two"));
  const titles = titlesOf(await deps.sheets.metadata(id));
  if (args.metadataId !== undefined) return { spreadsheetId: id, matches: [metadataView(await deps.sheets.getDeveloperMetadata(id, args.metadataId), titles)] };
  const answer = await deps.sheets.searchDeveloperMetadata(id, checkedFilters(args.dataFilters, "data_filters"));
  return { spreadsheetId: id, matches: (answer.matchedDeveloperMetadata ?? []).map((m) => metadataView(m.developerMetadata ?? {}, titles)) };
};

export type AppendValuesArgs = ValueWriteOptions & {
  readonly spreadsheetId: string;
  readonly range: string;
  readonly values: readonly (readonly CellValue[])[];
  readonly insertDataOption: string;
};

export const appendValues = async (deps: Deps, args: AppendValuesArgs) => {
  const id = fileIdFrom(args.spreadsheetId);
  const { valueInputOption, majorDimension, includeValuesInResponse, insertDataOption } = args;
  const answer = await deps.sheets.appendValues(id, args.range, args.values, { valueInputOption, majorDimension, includeValuesInResponse, insertDataOption });
  const u = answer.updates ?? {};
  return {
    spreadsheetId: id,
    ...(answer.tableRange ? { tableRange: answer.tableRange } : {}),
    updatedRange: u.updatedRange ?? "",
    updatedRows: u.updatedRows ?? 0,
    updatedCells: u.updatedCells ?? 0,
    ...(u.updatedData?.values ? { values: u.updatedData.values } : {}),
  };
};

/** One sheet copied into another spreadsheet (or the same one): it arrives as "Copy of <title>", last. */
export const copySheetTo = async (deps: Deps, args: { readonly spreadsheetId: string; readonly sheet: string; readonly destinationId: string }) => {
  const id = fileIdFrom(args.spreadsheetId);
  const destination = args.destinationId ? fileIdFrom(args.destinationId) : id;
  const meta = await deps.sheets.metadata(id);
  const asId = /^\d+$/.test(args.sheet.trim()) ? Number(args.sheet.trim()) : undefined;
  const byId = asId === undefined ? undefined : (meta.sheets ?? []).find((s) => s.properties?.sheetId === asId);
  const sheetId = byId?.properties?.sheetId ?? sheetSummary(pickSheet(meta, args.sheet)).sheetId;
  const copy = await deps.sheets.copySheet(id, sheetId, destination);
  return { spreadsheetId: destination, link: linkOf(destination), sheetId: copy.sheetId ?? null, title: copy.title ?? "", index: copy.index ?? null };
};
