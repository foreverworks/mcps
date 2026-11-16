import { makeErrorKit } from "@foreverworks/mcp-kit";

/** The ways this server fails, as plain tagged data (packages/mcp-kit, errors.ts). */
export type AppError =
  /** The arguments cannot be answered as asked; nothing was fetched. */
  | { readonly kind: "input"; readonly message: string }
  /** The ECB has no such rate: a currency its fixing does not carry, a day before the series began. */
  | { readonly kind: "not_found"; readonly message: string }
  /** The ECB's server failed or could not be reached (status 0 is no connection). */
  | { readonly kind: "api"; readonly status: number; readonly message: string }
  /** The ECB answered with something that is not its rates XML (an HTML page, a changed format). */
  | { readonly kind: "drift"; readonly message: string };

export const inputError = (message: string): AppError => ({ kind: "input", message });
export const notFound = (message: string): AppError => ({ kind: "not_found", message });
export const drift = (message: string): AppError => ({ kind: "drift", message });

export const { fail, asAppError } = makeErrorKit<AppError>("ecb");

/** What to do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "input":
      return "fix what the message names and call again";
    case "not_found":
      return "the ECB publishes no such rate: check the currency code and the date, and note that currencies join and leave its list over time";
    case "api":
      return "the ECB's server did not answer; retry in a few minutes";
    case "drift":
      return "the ECB's XML is not what this server expects: compare https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml with the server's README and fix the adapter";
  }
};
