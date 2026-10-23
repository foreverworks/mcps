import type { FileSource, InputFile } from "@foreverworks/mcp-kit";

import { fail, inputError } from "../../domain/errors.js";

/**
 * A document the caller hands in, one of two ways, both byte-exact (mcp-kit's
 * input-file reader): by path, inside the server's file roots, or as base64 a
 * script wrote, with the SOURCE file's sha256, which the reader checks before
 * anything is sent. There is no third way: a document typed out by a model as
 * text is a retyping, and a retyped invoice can change by one character with
 * nothing noticing (one in about 6,200 base64 characters, measured).
 */
export type DocumentInput = {
  /** The argument's name, for the messages. */
  readonly name: string;
  /** Absent when the caller did not give it. */
  readonly source?: FileSource;
};

type ReadInput = (source: FileSource) => Promise<InputFile>;

/** What was read, as a result reports it: which file, how big, and its hash. */
export type DocumentRead = { readonly name: string; readonly size: number; readonly sha256: string; readonly path?: string | undefined };

export const describeRead = (file: InputFile): DocumentRead => ({
  name: file.name,
  size: file.size,
  sha256: file.sha256,
  ...(file.path === undefined ? {} : { path: file.path }),
});

const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * A file's bytes as the text the XML tools take: strictly UTF-8, a byte-order
 * mark kept, so the text encodes back to exactly the bytes that were read.
 */
export const utf8Text = (file: InputFile, what: string): string => utf8Of(file.bytes, `${what} ${file.name}`);

/** Bytes as that text, wherever they came from (a file, an archive's entry); `label` names them in the refusal. */
export const utf8Of = (bytes: Uint8Array, label: string): string => {
  try {
    return UTF8.decode(bytes);
  } catch {
    return fail(inputError(`${label} is not UTF-8 text, and an e-Factura document is`));
  }
};

/** Whether the caller gave this document at all. */
export const given = (input: DocumentInput): boolean => input.source !== undefined;

/** The document, read and checked; undefined when it was not given (the caller says whether that is an error). */
export const readDocument = async (readInput: ReadInput, input: DocumentInput): Promise<InputFile | undefined> =>
  input.source === undefined ? undefined : readInput(input.source);

/** The document as text, for the tools that send ANAF text, with what was read; undefined when it was not given. */
export const readDocumentText = async (
  readInput: ReadInput,
  input: DocumentInput,
): Promise<{ readonly text: string; readonly read: DocumentRead } | undefined> => {
  const file = await readDocument(readInput, input);
  return file === undefined ? undefined : { text: utf8Text(file, input.name), read: describeRead(file) };
};
