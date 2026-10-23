import type { InputFiles } from "@foreverworks/mcp-kit";
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
export const documentInput = (name: string, arg: FileArg): DocumentInput => ({
  name,
  ...(arg === undefined
    ? {}
    : { source: { path: arg.path, contentBase64: arg.content_base64, sha256: arg.sha256, name: arg.filename } }),
});
