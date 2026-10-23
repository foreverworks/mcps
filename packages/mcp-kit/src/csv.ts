/**
 * CSV for the files a server hands back (an export of receipts, a bank
 * statement), written for the two kinds of reader such a file meets: a program
 * that parses it, and a person who double-clicks it into a spreadsheet.
 *
 * Every cell is quoted, with inner quotes doubled (RFC 4180), so a comma, a
 * quote or a line break inside a merchant's name cannot shift a column.
 *
 * A cell that a spreadsheet would read as a formula is defused with a leading
 * apostrophe. These files carry text other people wrote (a payment reference, a
 * product name), and a reference such as `=HYPERLINK(...)` would otherwise run
 * when the file is opened (OWASP, "CSV Injection"). A plain negative number such
 * as `-12.50` is left alone: it is data, and an amount column must stay an
 * amount column.
 */

const FORMULA_START = /^[=+@\t\r]|^-(?![\d.])/;

const cell = (value: unknown): string => {
  const text = String(value ?? "");
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** A header line naming `columns`, then one line per row; a missing value is an empty cell. Ends with a newline. */
export const csvOf = <Row extends Readonly<Record<string, unknown>>>(columns: readonly (keyof Row & string)[], rows: readonly Row[]): string =>
  [columns.join(","), ...rows.map((row) => columns.map((column) => cell(row[column])).join(","))].join("\n") + "\n";
