import { makeErrorKit } from "@foreverworks/mcp-kit";

/** The ways this server fails, as plain tagged data (packages/mcp-kit, errors.ts). */
export type AppError =
  /** The arguments cannot be done as asked; nothing was sent to the device. */
  | { readonly kind: "input"; readonly message: string }
  /** A setting this needs is missing or wrong; `variable` names it. */
  | { readonly kind: "config"; readonly variable: string; readonly message: string }
  /** The device did not answer: off, asleep beyond waking, or no route to it. */
  | { readonly kind: "unreachable"; readonly device: "printer" | "scanner"; readonly message: string }
  /** The device's TLS certificate is not the one pinned (or none is pinned); `sha256` is the one it showed. */
  | { readonly kind: "tls"; readonly sha256?: string; readonly message: string }
  /** The printer refused an IPP request; `status` is its IPP status keyword. */
  | { readonly kind: "printer"; readonly status: string; readonly message: string }
  /** The device is busy or not taking work now (a scan in progress, the printer stopped). */
  | { readonly kind: "busy"; readonly device: "printer" | "scanner"; readonly message: string }
  /** The device answered with something this server does not understand. */
  | { readonly kind: "drift"; readonly message: string }
  /** The document could not be turned into pages (a damaged PDF, a missing renderer). */
  | { readonly kind: "render"; readonly message: string }
  /** Correction was asked for and there is no usable calibration. */
  | { readonly kind: "calibration"; readonly message: string };

export const inputError = (message: string): AppError => ({ kind: "input", message });
export const drift = (message: string): AppError => ({ kind: "drift", message });

export const { fail, asAppError } = makeErrorKit<AppError>("printer");

/** What to do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "input":
      return "fix what the message names and call again";
    case "config":
      return `set ${error.variable} in this server's environment (see its README) and restart it`;
    case "unreachable":
      return `check that the ${error.device} is switched on and that this machine has a route to it, then call status`;
    case "tls":
      return error.sha256 === undefined || error.sha256 === ""
        ? "check the device's certificate and set PRINTER_TLS_SHA256 to its SHA-256 fingerprint"
        : `if the device's own web page shows this certificate, set PRINTER_TLS_SHA256=${error.sha256}; a certificate that changed unexpectedly is a reason to stop and look`;
    case "printer":
      return "read the printer's message; status shows what it reports (paper, toner, a cover)";
    case "busy":
      return error.device === "scanner" ? "wait for the scan in progress to finish, then try again" : "status says why the printer is not taking jobs; fix that, then try again";
    case "drift":
      return "the device answered unlike its protocol says; note its model and firmware (status) and report it";
    case "render":
      return "open the file to check it is a complete PDF, PNG or JPEG; if it opens, check that poppler's pdftoppm and pdfinfo are installed";
    case "calibration":
      return "call with correction: false, or load a calibration with load_calibration";
  }
};
