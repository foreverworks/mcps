import { makeErrorKit } from "@foreverworks/mcp-kit";

/** The ways this server fails, as plain tagged data (packages/mcp-kit, errors.ts). */
export type AppError =
  /** The arguments cannot be answered as asked; nothing was fetched. */
  | { readonly kind: "input"; readonly message: string }
  /** BNR has no such rate: a currency it did not publish then, a year with no file yet. */
  | { readonly kind: "not_found"; readonly message: string }
  /** BNR's server failed or could not be reached (status 0 is no connection). */
  | { readonly kind: "api"; readonly status: number; readonly message: string }
  /** BNR answered with something that is not its rates XML (an HTML page, a changed format). */
  | { readonly kind: "drift"; readonly message: string };

export const inputError = (message: string): AppError => ({ kind: "input", message });
export const notFound = (message: string): AppError => ({ kind: "not_found", message });
export const drift = (message: string): AppError => ({ kind: "drift", message });

export const { fail, asAppError } = makeErrorKit<AppError>("bnr");

/** What to do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "input":
      return "fix what the message names and call again";
    case "not_found":
      return "BNR publishes no such rate: check the currency code and the date; a year's file exists from its first banking day";
    case "api":
      return "BNR's server did not answer; retry in a few minutes";
    case "drift":
      return "BNR's XML is not where or what this server expects: compare https://curs.bnr.ro/ with the server's README and fix the adapter";
  }
};
