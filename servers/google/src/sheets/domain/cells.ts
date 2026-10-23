import { compare, exactNumberText, parseDecimal, toDecimal } from "@foreverworks/mcp-kit";

import { fail, inputError } from "./errors.js";
import type { CellDataOut, RawCellData } from "./schema.js";

/**
 * Cell values as JSON, both ways. Pure.
 *
 * Read: the UNFORMATTED value, typed by the cell's number format. A date is
 * an ISO string, a number stays a number, and a currency cell also carries
 * its value as an exact decimal string, because money is never handed on as
 * a float for someone to add up.
 *
 * Write: the same shapes back, so a row read, changed and written round-trips.
 */

/** A currency-formatted cell: the stored number, the same number as a decimal string, and what the sheet shows. */
export type Money = { readonly value: number; readonly amount: string; readonly formatted: string };

export type CellValue = string | number | boolean | null | Money | { readonly error: string };

/** Day 0 of Sheets' serial dates (as in Lotus and Excel): 1899-12-30. */
const EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_S = 86_400;

const isoFromSerial = (serial: number): string => new Date(EPOCH_MS + Math.round(serial * DAY_S) * 1000).toISOString();

/**
 * Sheets' own notion of a date: a number format of type DATE, DATE_TIME or
 * TIME. The value is sheet-local wall time with no zone, so no zone is added:
 * `2026-09-28T09:30:00` means what the sheet shows, in the spreadsheet's time
 * zone (list_sheets reports it).
 */
const dateOf = (serial: number, type: string): string | undefined => {
  if (type === "DATE") return isoFromSerial(serial).slice(0, 10);
  if (type === "DATE_TIME") return isoFromSerial(serial).slice(0, 19);
  if (type === "TIME") return isoFromSerial(serial - Math.floor(serial)).slice(11, 19);
  return undefined;
};

/** A currency symbol or Sheets' locale currency token ("[$RON]") in the pattern, whatever the declared type. */
const CURRENCY_PATTERN = /\[\$|[€$£¥₹₽₺₩₴]|"(?:lei|ron|eur|usd|gbp|chf)"/i;

const isCurrency = (type: string, pattern: string): boolean => type === "CURRENCY" || CURRENCY_PATTERN.test(pattern);

/**
 * The decimal string of a number exactly as the API sent it: JavaScript's
 * shortest round-trip form, with no arithmetic in between. Exponent notation
 * (1e-7, 1e21) is spelled out, because an amount is read by people and
 * parsers that do not expect it.
 */
export const exactDecimal = (n: number): string => {
  const text = String(n);
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text);
  if (!match) return text;
  const [, sign = "", lead = "", tail = "", exp = "0"] = match;
  const digits = lead + tail;
  const point = 1 + Number(exp);
  if (point <= 0) return `${sign}0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return `${sign}${digits}${"0".repeat(point - digits.length)}`;
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`;
};

/** One cell as JSON. An empty cell is null; an error is `{ error: "#REF!" }`, not a string that looks like data. */
export const typedValue = (cell: RawCellData | undefined): CellValue => {
  const value = cell?.effectiveValue;
  if (!value) return null;
  if (value.errorValue) return { error: cell?.formattedValue ?? value.errorValue.type ?? "#ERROR!" };
  if (typeof value.boolValue === "boolean") return value.boolValue;
  if (typeof value.stringValue === "string") return value.stringValue;
  if (typeof value.numberValue !== "number") return null;
  const format = cell?.effectiveFormat?.numberFormat;
  const type = format?.type ?? "";
  const date = dateOf(value.numberValue, type);
  if (date !== undefined) return date;
  if (isCurrency(type, format?.pattern ?? "")) {
    return { value: value.numberValue, amount: exactDecimal(value.numberValue), formatted: cell?.formattedValue ?? "" };
  }
  return value.numberValue;
};

/** The text a header cell shows, which is what a person reads as the column's name. */
export const shownText = (cell: RawCellData | undefined): string => (cell?.formattedValue ?? "").trim();

/** A value as written: the primitives JSON has, an ISO date, or a currency value as read_rows returned it. */
export type WritableValue = string | number | boolean | null | { readonly amount: string };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/;

const serialOf = (y: string, mo: string, d: string, h = "0", mi = "0", s = "0"): number =>
  (Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s)) - EPOCH_MS) / (DAY_S * 1000);

/**
 * A cell to write, and the fields it sets. A plain value sets only the value,
 * so a cell keeps the format it already has (a currency column stays one); a
 * date also sets a date format, because a serial number without one reads as
 * 46293. "=..." is a formula; any other string is text, verbatim ("00123"
 * keeps its zeros).
 */
/**
 * An amount as the number Sheets stores: a plain decimal (the kit's
 * DECIMAL_TEXT: no exponent, no comma, no blank), and one a double holds
 * exactly. Sheets keeps every number as a double, so an amount it cannot hold
 * is refused rather than rounded on the way in.
 */
export const amountToNumber = (amount: string): number => {
  const decimal = parseDecimal(amount) ?? fail(inputError(`amount "${amount.slice(0, 40)}" is not a plain decimal like "12.50"`));
  const n = Number(amount);
  const stored = exactNumberText(n);
  if (stored === undefined || compare(toDecimal(stored), decimal) !== 0) {
    return fail(inputError(`amount "${amount}" has more digits than a Sheets number holds exactly`));
  }
  return n;
};

export const cellToWrite = (value: WritableValue): { readonly cell: CellDataOut; readonly fields: string } => {
  if (value === null) return { cell: {}, fields: "userEnteredValue" };
  if (typeof value === "boolean") return { cell: { userEnteredValue: { boolValue: value } }, fields: "userEnteredValue" };
  if (typeof value === "number") return { cell: { userEnteredValue: { numberValue: value } }, fields: "userEnteredValue" };
  if (typeof value === "object") return { cell: { userEnteredValue: { numberValue: amountToNumber(value.amount) } }, fields: "userEnteredValue" };
  if (value.startsWith("=")) return { cell: { userEnteredValue: { formulaValue: value } }, fields: "userEnteredValue" };
  const date = ISO_DATE.exec(value);
  const dateTime = ISO_DATE_TIME.exec(value);
  const parts = date ?? dateTime;
  if (parts) {
    const [, y = "", mo = "", d = "", h, mi, s] = parts;
    const format = date ? { type: "DATE", pattern: "yyyy-mm-dd" } : { type: "DATE_TIME", pattern: "yyyy-mm-dd hh:mm:ss" };
    return {
      cell: { userEnteredValue: { numberValue: serialOf(y, mo, d, h, mi, s) }, userEnteredFormat: { numberFormat: format } },
      fields: "userEnteredValue,userEnteredFormat.numberFormat",
    };
  }
  return { cell: { userEnteredValue: { stringValue: value } }, fields: "userEnteredValue" };
};

/** Two keys are the same when their typed values print the same: 1001 matches "1001", a date matches its ISO string. */
export const keyText = (value: CellValue | WritableValue): string =>
  value === null ? "" : typeof value === "object" ? ("amount" in value ? value.amount : value.error) : String(value).trim();
