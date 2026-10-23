import { fail, inputError } from "./errors.js";
import type { State } from "./schema.js";

/**
 * Rows for a batch, from a file rather than typed into the call: a thousand
 * states retyped by a model is a thousand chances to change one. Pure: the
 * bytes were read and checked by the kit's input-file reader.
 *
 * Two layouts, told apart by the first character: a JSON array of rows, or
 * JSONL, one row per line (blank lines skipped). A row is `{"state": ...}`
 * with an optional `"id"`, the same shape `items` takes.
 */

export type BatchItem = { readonly id?: string | undefined; readonly state: State };

/** The most rows one batch takes, whichever way they come. */
export const MAX_BATCH_ITEMS = 1000;

/**
 * Above this many rows every row needs its own id. A reply names rows by id,
 * and an index is only safe to join back on while the rows are few enough to
 * check by eye: past that, one row dropped or reordered on the way shifts
 * every answer onto the wrong row without a sign.
 */
export const MAX_UNNAMED_ROWS = 20;

const MAX_ID = 200;

/** What TypeSafe accepts as a state: text, a JSON object or array (not null, which it reads as no state). */
const isState = (value: unknown): value is State => value !== null && (typeof value === "string" || typeof value === "object");

const rowOf = (value: unknown, where: string): BatchItem => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return fail(inputError(`${where} is not an object with a "state"`));
  const { id, state } = value as { readonly id?: unknown; readonly state?: unknown };
  if (!("state" in value) || !isState(state)) return fail(inputError(`${where} has no "state" of text, a JSON object or array`));
  if (id !== undefined && (typeof id !== "string" || id.length === 0 || id.length > MAX_ID)) {
    return fail(inputError(`${where}: "id" must be text of 1 to ${MAX_ID} characters`));
  }
  return id === undefined ? { state } : { id, state };
};

const parsed = (text: string, where: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch (cause) {
    return fail(inputError(`${where} is not JSON: ${String(cause).slice(0, 200)}`));
  }
};

export const parseBatchItems = (text: string): readonly BatchItem[] => {
  const body = text.replace(/^﻿/, "");
  const rows = body.trimStart().startsWith("[")
    ? (() => {
        const all = parsed(body, "items_file");
        return Array.isArray(all) ? all.map((row, i) => rowOf(row, `items_file row ${i + 1}`)) : fail(inputError("items_file is not a JSON array"));
      })()
    : body.split("\n").flatMap((line, i) => (line.trim() === "" ? [] : [rowOf(parsed(line, `items_file line ${i + 1}`), `items_file line ${i + 1}`)]));
  if (rows.length === 0) return fail(inputError("items_file holds no rows"));
  if (rows.length > MAX_BATCH_ITEMS) return fail(inputError(`items_file holds ${rows.length} rows; a batch takes at most ${MAX_BATCH_ITEMS}, so split it`));
  return rows;
};
