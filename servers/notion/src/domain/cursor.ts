import { fail, inputError } from "./errors.js";

/**
 * The next-page cursor of a call that read several workspaces at once. Each
 * workspace has its own cursor, so the one handed back carries all of them,
 * as base64url JSON: opaque to the caller, and one argument either way. A
 * workspace missing from it is finished.
 */
export type Cursors = Readonly<Record<string, string>>;

export const encodeCursors = (cursors: Cursors): string | undefined =>
  Object.keys(cursors).length === 0 ? undefined : Buffer.from(JSON.stringify(cursors)).toString("base64url");

export const decodeCursors = (cursor: string): Cursors => {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && Object.values(parsed).every((v) => typeof v === "string")) {
      return parsed as Cursors;
    }
  } catch {
    // Falls through to the refusal: the cursor was not one this server made.
  }
  return fail(inputError("cursor is not one this tool returned; pass nextCursor exactly as it came back"));
};
