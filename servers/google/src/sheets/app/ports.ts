/**
 * What the Sheets use cases need, named as operations. No URL appears above infra/.
 */
import type { Deps as DriveDeps } from "../../drive/app/ports.js";
import type { ApiRequest } from "../../editors/domain/discovery.js";
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
  SheetsRequest,
} from "../domain/schema.js";

/** A cell as the values API takes it. */
export type CellValue = string | number | boolean | null;

/** How much of a spreadsheet a read asks for. */
export type GetOptions = {
  /** A1 ranges whose grid data to include; every sheet when empty. */
  readonly ranges?: readonly string[];
  readonly includeGridData?: boolean;
  /** A partial response: Google's field mask over the Spreadsheet. */
  readonly fields?: string;
};

export type ValueReadOptions = {
  readonly valueRenderOption: string;
  readonly dateTimeRenderOption: string;
  readonly majorDimension: string;
};

export type ValueWriteOptions = {
  readonly valueInputOption: string;
  readonly majorDimension: string;
  readonly includeValuesInResponse: boolean;
};

export type SheetsPort = {
  /** The spreadsheet's title, locale, time zone and every sheet's properties; no cells. */
  readonly metadata: (spreadsheetId: string) => Promise<RawSpreadsheet>;
  /** One whole sheet: its properties and every cell's effective value, shown text and number format. */
  readonly grid: (spreadsheetId: string, sheetTitle: string) => Promise<RawSpreadsheet>;
  /** One atomic batch of structural requests: all apply or none do. */
  readonly batchUpdate: (spreadsheetId: string, requests: readonly SheetsRequest[]) => Promise<RawBatchUpdateResponse>;
  /** What an A1 range holds as entered: formulas as formulas, values unformatted. */
  readonly readValues: (spreadsheetId: string, range: string) => Promise<RawValueRange>;
  /** Values into an A1 range, parsed as if typed into the sheet (USER_ENTERED). */
  readonly writeValues: (spreadsheetId: string, range: string, values: readonly (readonly (string | number | boolean | null)[])[]) => Promise<RawUpdateValuesResponse>;
  /** The spreadsheet as asked: metadata, grid data for some ranges, or a field mask's worth. */
  readonly get: (spreadsheetId: string, options: GetOptions) => Promise<RawSpreadsheet>;
  /** Any requests the API takes, checked against its schema by the caller; every reply comes back. */
  readonly apply: (spreadsheetId: string, requests: readonly ApiRequest[]) => Promise<RawBatchUpdateResponse>;
  readonly getValues: (spreadsheetId: string, ranges: readonly string[], options: ValueReadOptions) => Promise<RawBatchGetValuesResponse>;
  readonly updateValues: (
    spreadsheetId: string,
    data: readonly { readonly range: string; readonly values: readonly (readonly CellValue[])[] }[],
    options: ValueWriteOptions,
  ) => Promise<RawBatchUpdateValuesResponse>;
  readonly clearValues: (spreadsheetId: string, ranges: readonly string[]) => Promise<RawBatchClearValuesResponse>;
  /** Rows after the table Sheets finds at `range`; never retried, since a second try would add them twice. */
  readonly appendValues: (
    spreadsheetId: string,
    range: string,
    values: readonly (readonly CellValue[])[],
    options: ValueWriteOptions & { readonly insertDataOption: string },
  ) => Promise<RawAppendValuesResponse>;
  /**
   * The DataFilter family: the same reads and writes, with cells chosen by
   * filters (A1, a GridRange, or developer metadata) instead of A1 ranges.
   * Filters are checked against the API's schema by the caller.
   */
  readonly getByDataFilter: (spreadsheetId: string, dataFilters: readonly unknown[], options: { readonly includeGridData: boolean; readonly fields?: string }) => Promise<RawSpreadsheet>;
  readonly getValuesByDataFilter: (spreadsheetId: string, dataFilters: readonly unknown[], options: ValueReadOptions) => Promise<RawBatchGetValuesByDataFilterResponse>;
  readonly updateValuesByDataFilter: (
    spreadsheetId: string,
    data: readonly { readonly dataFilter: unknown; readonly values: readonly (readonly CellValue[])[] }[],
    options: ValueWriteOptions,
  ) => Promise<RawBatchUpdateValuesByDataFilterResponse>;
  readonly clearValuesByDataFilter: (spreadsheetId: string, dataFilters: readonly unknown[]) => Promise<RawBatchClearValuesByDataFilterResponse>;
  readonly searchDeveloperMetadata: (spreadsheetId: string, dataFilters: readonly unknown[]) => Promise<RawSearchDeveloperMetadataResponse>;
  readonly getDeveloperMetadata: (spreadsheetId: string, metadataId: number) => Promise<RawDeveloperMetadata>;
  /** A copy of one sheet into another spreadsheet (or the same one); answers the copy's properties. */
  readonly copySheet: (spreadsheetId: string, sheetId: number, destinationSpreadsheetId: string) => Promise<RawSheetProperties>;
};

export type Deps = {
  readonly account: string;
  readonly sheets: SheetsPort;
  /** The Drive product's own port and use cases, under the same grant: a new spreadsheet goes into its folder through them. */
  readonly drive: DriveDeps;
};
