import { type InputFiles, sha256Of } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { DocumentInput } from "../app/usecases/inputFiles.js";

/**
 * A document argument: one object in the kit's file shape, given one of two
 * byte-exact ways (app/usecases/inputFiles.ts): `{ path }`, a file in the
 * server's file roots (optionally with its `sha256`, then checked), or
 * `{ content_base64, sha256, filename }`, which is what a file-sending script
 * (MCP_FILE_SCRIPT) puts at an argument. The sentences come from the reader,
 * so what a tool says and what it accepts cannot differ.
 */
export const fileArg = (what: string, files: InputFiles) =>
  z
    .object({
      path: z.string().optional().describe(`${files.where}. Read byte for byte.`),
      content_base64: z.string().optional().describe("The file's bytes as standard base64, as a script that read the file wrote them. Needs sha256."),
      sha256: z
        .string()
        .optional()
        .describe("Hex SHA-256 of the source file, as sha256sum prints it: required with content_base64, checked with path. A mismatch fails as checksum_mismatch and nothing is sent."),
      filename: z.string().optional(),
    })
    .describe(`${what}: { path } or { content_base64, sha256 }. ${files.help}`);

export type FileArg =
  | {
      readonly path?: string | undefined;
      readonly content_base64?: string | undefined;
      readonly sha256?: string | undefined;
      readonly filename?: string | undefined;
    }
  | undefined;

/** The argument as the use case takes it; `name` is the argument's own name, for the messages. */
export const documentInput = (name: string, arg: FileArg | string): DocumentInput =>
  typeof arg === "string" ? textInput(name, arg) : pathOrBase64(name, arg);

const pathOrBase64 = (name: string, arg: FileArg): DocumentInput => ({
  name,
  ...(arg === undefined
    ? {}
    : { source: { path: arg.path, contentBase64: arg.content_base64, sha256: arg.sha256, name: arg.filename } }),
});

/**
 * The one exception to "a document goes in by path or as a script's checked
 * base64" (app/usecases/inputFiles.ts), for a server with no grant and so no
 * disk of its own to read from (mcp/toolsets.ts, Mode.grantless): the XML as
 * text. Its bytes are the text's UTF-8, which the server hashes itself, so the
 * checksum cannot catch a retyping here; every result reports the sha256 and
 * size it received (`file`), for the caller to compare with its source. Where a
 * server has a grant, or file roots, the exception is not offered.
 */
export const XML_TEXT_MAX_CHARS = 1_048_576;

export const xmlTextArg = (what: string) =>
  z
    .string()
    .min(1)
    .max(XML_TEXT_MAX_CHARS)
    .describe(
      `${what}, as the XML text itself (at most ${XML_TEXT_MAX_CHARS} characters). The server hashes the bytes it receives and answers their sha256 and size (file), so compare them with your source.`,
    );

const textInput = (name: string, text: string): DocumentInput => {
  const bytes = Buffer.from(text, "utf8");
  return { name, source: { contentBase64: bytes.toString("base64"), sha256: sha256Of(bytes) } };
};
