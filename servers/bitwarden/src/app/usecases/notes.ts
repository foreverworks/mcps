import type { FileSource } from "@foreverworks/mcp-kit";

import { cliError, fail, inputError } from "../../domain/errors.js";
import { fieldFromFile, fieldTooLong, notesTooLong, repeatedNames } from "../../domain/note.js";
import type { Field, Login } from "../../domain/schema.js";
import { summaryOf } from "../../domain/views.js";
import type { Deps } from "../ports.js";
import { placeFor } from "./place.js";

/** One custom field of a new note: its value typed into the call, or read from a file so a long secret is never retyped. */
export type NewNoteField = {
  readonly name: string;
  readonly value?: string;
  readonly file?: FileSource;
  readonly hidden: boolean;
};

export type NewNote = {
  readonly name: string;
  /** Plain text: get_login shows it to anyone who reads the note. */
  readonly notes?: string;
  readonly fields: readonly NewNoteField[];
  readonly collection?: string;
};

/** A field ready to store, and for one read from a file, the file's checksum and size. */
type Taken = { readonly field: Field; readonly file?: { readonly sha256: string; readonly size: number } };

const fits = (problem: string | undefined): void => {
  if (problem !== undefined) fail(inputError(problem));
};

const takeField = async (deps: Deps, given: NewNoteField): Promise<Taken> => {
  const name = given.name.trim();
  if ((given.value === undefined) === (given.file === undefined)) return fail(inputError(`field ${name}: give value or file, exactly one`));
  if (given.file === undefined) {
    const value = given.value as string;
    fits(fieldTooLong(name, value));
    return { field: { name, value, hidden: given.hidden } };
  }
  const read = await deps.readInput(given.file);
  const text = fieldFromFile(read.bytes);
  if ("refused" in text) return fail(inputError(`field ${name}: ${text.refused}`));
  fits(fieldTooLong(name, text.text));
  return { field: { name, value: text.text, hidden: given.hidden }, file: { sha256: read.sha256, size: read.size } };
};

/** What differs between the note as sent and as the vault read it back, or `undefined` when nothing does. */
const storedDifferently = (created: Login, notes: string | null, taken: readonly Taken[]): string | undefined => {
  if (created.notes !== notes) return "its notes";
  const differs = taken.filter(({ field }) => {
    const stored = created.fields.filter((f) => f.name === field.name);
    return stored.length !== 1 || stored[0]!.value !== field.value || stored[0]!.hidden !== field.hidden;
  });
  return differs.length === 0 ? undefined : `field ${differs.map((t) => t.field.name).join(", ")}`;
};

/**
 * A new secure note, for a secret that is not a login: a service account's key
 * file, an API token, a licence. Each secret goes in a custom field, hidden by
 * default, so get_login names it without its value and get_field hands it out.
 * Every file is read and every limit checked before anything is sent; what the
 * vault stored is read back and compared with what was sent. The result names
 * each field with its length, and a file's SHA-256 and size, never a value.
 */
export const createNote = async (deps: Deps, args: NewNote) => {
  if (args.fields.length === 0) return fail(inputError("a note keeps its secret in a field: give at least one in fields"));
  const twice = repeatedNames(args.fields.map((f) => f.name));
  if (twice.length > 0) return fail(inputError(`field names must differ (get_field finds one by name, ignoring case): ${twice.join(", ")}`));
  const notes = args.notes === undefined || args.notes === "" ? null : args.notes;
  if (notes !== null) fits(notesTooLong(notes));
  const taken: Taken[] = [];
  for (const field of args.fields) taken.push(await takeField(deps, field));
  const place = await placeFor(deps, args.collection);
  const created = await deps.vault.createNote({ name: args.name, ...place, notes, fields: taken.map((t) => t.field) });
  const differs = storedDifferently(created, notes, taken);
  if (differs !== undefined) {
    return fail(cliError(`note ${created.id} was created, but the vault read back ${differs} differently from what was sent; check it in the web vault`));
  }
  return {
    ...summaryOf(created, await deps.vault.collections()),
    ...(notes === null ? {} : { notesLength: [...notes].length }),
    fields: taken.map(({ field, file }) => ({
      name: field.name,
      hidden: field.hidden,
      length: [...(field.value ?? "")].length,
      ...(file === undefined ? {} : { fromFile: { sha256: file.sha256, size: file.size } }),
    })),
  };
};
