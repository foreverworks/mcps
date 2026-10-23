/**
 * Reading JSON this server did not just receive from the API: sessions.json,
 * which other programs may have written too, in other shapes. Everything
 * arrives as `unknown` and is narrowed here, one field at a time, so a shape
 * nobody expected degrades one entry instead of throwing.
 */
export type Json = Readonly<Record<string, unknown>>;

export const record = (value: unknown): Json | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined;

/** A non-blank string, trimmed; `undefined` for anything else, including "". */
export const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

export const list = (value: unknown): readonly unknown[] => (Array.isArray(value) ? value : []);
