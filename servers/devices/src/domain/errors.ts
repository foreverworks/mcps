import { makeErrorKit } from "@foreverworks/mcp-kit";

/**
 * The ways this server fails, as plain tagged data (packages/mcp-kit, errors.ts).
 * A device that is busy or a host that is down is NOT a failure: acquire
 * answers `queued` or `unavailable` with the reason. These are for calls that
 * cannot be answered as asked.
 */
export type AppError =
  /** The catalog or the state directory is missing or unreadable; the broker cannot work as configured. */
  | { readonly kind: "config"; readonly message: string }
  /** The request names something that does not exist or is not the caller's. */
  | { readonly kind: "input"; readonly message: string }
  /** A host refused or failed a command the broker sent it (ssh, simctl, adb). */
  | { readonly kind: "host"; readonly host: string; readonly message: string };

export const { fail, asAppError } = makeErrorKit<AppError>("devices");

export const inputError = (message: string): AppError => ({ kind: "input", message });
export const configError = (message: string): AppError => ({ kind: "config", message });
export const hostError = (host: string, message: string): AppError => ({ kind: "host", host, message });

/** What the operator should do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      return "point DEVICES_CATALOG_FILE at a readable catalog in the README's format and DEVICES_STATE_DIR at a writable directory, then restart the broker";
    case "input":
      return "fix what the message names: status lists the leases you hold and the devices that exist";
    case "host":
      return "the host did not do what was asked; status shows its health, and a second try after a minute usually tells a blip from a fault";
  }
};
