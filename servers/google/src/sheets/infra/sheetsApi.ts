import type { SheetsPort } from "../app/ports.js";
import { quoteSheet } from "../domain/a1.js";
import type {
  RawAppendValuesResponse,
  RawBatchClearValuesByDataFilterResponse,
  RawBatchClearValuesResponse,
  RawBatchGetValuesByDataFilterResponse,
  RawBatchGetValuesResponse,
  RawBatchUpdateValuesByDataFilterResponse,
  RawDeveloperMetadata,
  RawSearchDeveloperMetadataResponse,
  RawBatchUpdateResponse,
  RawBatchUpdateValuesResponse,
  RawSheetProperties,
  RawSpreadsheet,
  RawUpdateValuesResponse,
  RawValueRange,
} from "../domain/schema.js";
import type { Request } from "../../infra/httpJson.js";

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

const spreadsheetUrl = (id: string): string => `${SHEETS}/${encodeURIComponent(id)}`;

const PROPERTIES = "properties(sheetId,title,index,sheetType,hidden,gridProperties)";

/**
 * Only what a typed read needs from each cell: the value, what the sheet
 * shows, and the number format that says whether a number is a date or money.
 * Grid data is Sheets' largest payload; everything else is left behind.
 */
const CELLS = "data(rowData(values(effectiveValue,formattedValue,userEnteredValue,hyperlink,textFormatRuns,chipRuns,note,dataValidation,userEnteredFormat/textFormat,effectiveFormat/numberFormat)))";

/**
 * The Sheets REST API. A structural batchUpdate is a POST and so is never
 * retried after a 5xx or a lost answer (httpJson): rows may have been written.
 * A values update is a PUT of the same cells, which is safe to repeat, and so
 * are a batch of them and a clear (POSTs said to be idempotent); an append is not.
 */
export const makeSheetsApi = (request: Request): SheetsPort => ({
  metadata: (id) =>
    request<RawSpreadsheet>(spreadsheetUrl(id), {
      query: { fields: `spreadsheetId,spreadsheetUrl,properties(title,locale,timeZone),sheets(${PROPERTIES})` },
    }),
  grid: (id, title) =>
    request<RawSpreadsheet>(spreadsheetUrl(id), {
      query: { ranges: quoteSheet(title), includeGridData: "true", fields: `sheets(${PROPERTIES},${CELLS})` },
    }),
  batchUpdate: (id, requests) =>
    request<RawBatchUpdateResponse>(`${spreadsheetUrl(id)}:batchUpdate`, { method: "POST", json: { requests } }),
  readValues: (id, range) =>
    request<RawValueRange>(`${spreadsheetUrl(id)}/values/${encodeURIComponent(range)}`, {
      query: { valueRenderOption: "FORMULA", majorDimension: "ROWS" },
    }),
  writeValues: (id, range, values) =>
    request<RawUpdateValuesResponse>(`${spreadsheetUrl(id)}/values/${encodeURIComponent(range)}`, {
      method: "PUT",
      query: { valueInputOption: "USER_ENTERED" },
      json: { range, majorDimension: "ROWS", values },
    }),
  get: (id, options) =>
    request<RawSpreadsheet>(spreadsheetUrl(id), {
      query: {
        ...(options.ranges && options.ranges.length > 0 ? { ranges: options.ranges } : {}),
        ...(options.includeGridData ? { includeGridData: "true" } : {}),
        ...(options.fields ? { fields: options.fields } : {}),
      },
    }),
  apply: (id, requests) => request<RawBatchUpdateResponse>(`${spreadsheetUrl(id)}:batchUpdate`, { method: "POST", json: { requests } }),
  getValues: (id, ranges, options) =>
    request<RawBatchGetValuesResponse>(`${spreadsheetUrl(id)}/values:batchGet`, { query: { ranges, ...options } }),
  updateValues: (id, data, options) =>
    request<RawBatchUpdateValuesResponse>(`${spreadsheetUrl(id)}/values:batchUpdate`, {
      method: "POST",
      idempotent: true,
      json: {
        valueInputOption: options.valueInputOption,
        includeValuesInResponse: options.includeValuesInResponse,
        data: data.map((d) => ({ range: d.range, majorDimension: options.majorDimension, values: d.values })),
      },
    }),
  clearValues: (id, ranges) =>
    request<RawBatchClearValuesResponse>(`${spreadsheetUrl(id)}/values:batchClear`, { method: "POST", idempotent: true, json: { ranges } }),
  appendValues: (id, range, values, options) =>
    request<RawAppendValuesResponse>(`${spreadsheetUrl(id)}/values/${encodeURIComponent(range)}:append`, {
      method: "POST",
      query: {
        valueInputOption: options.valueInputOption,
        insertDataOption: options.insertDataOption,
        includeValuesInResponse: options.includeValuesInResponse,
      },
      json: { range, majorDimension: options.majorDimension, values },
    }),
  // The filter variants are POSTs that only read (or write the same cells again): safe to repeat.
  getByDataFilter: (id, dataFilters, options) =>
    request<RawSpreadsheet>(`${spreadsheetUrl(id)}:getByDataFilter`, {
      method: "POST",
      idempotent: true,
      ...(options.fields ? { query: { fields: options.fields } } : {}),
      json: { dataFilters, includeGridData: options.includeGridData },
    }),
  getValuesByDataFilter: (id, dataFilters, options) =>
    request<RawBatchGetValuesByDataFilterResponse>(`${spreadsheetUrl(id)}/values:batchGetByDataFilter`, {
      method: "POST",
      idempotent: true,
      json: { dataFilters, ...options },
    }),
  updateValuesByDataFilter: (id, data, options) =>
    request<RawBatchUpdateValuesByDataFilterResponse>(`${spreadsheetUrl(id)}/values:batchUpdateByDataFilter`, {
      method: "POST",
      idempotent: true,
      json: {
        valueInputOption: options.valueInputOption,
        includeValuesInResponse: options.includeValuesInResponse,
        data: data.map((d) => ({ dataFilter: d.dataFilter, majorDimension: options.majorDimension, values: d.values })),
      },
    }),
  clearValuesByDataFilter: (id, dataFilters) =>
    request<RawBatchClearValuesByDataFilterResponse>(`${spreadsheetUrl(id)}/values:batchClearByDataFilter`, { method: "POST", idempotent: true, json: { dataFilters } }),
  searchDeveloperMetadata: (id, dataFilters) =>
    request<RawSearchDeveloperMetadataResponse>(`${spreadsheetUrl(id)}/developerMetadata:search`, { method: "POST", idempotent: true, json: { dataFilters } }),
  getDeveloperMetadata: (id, metadataId) => request<RawDeveloperMetadata>(`${spreadsheetUrl(id)}/developerMetadata/${metadataId}`),
  copySheet: (id, sheetId, destination) =>
    request<RawSheetProperties>(`${spreadsheetUrl(id)}/sheets/${sheetId}:copyTo`, { method: "POST", json: { destinationSpreadsheetId: destination } }),
});
