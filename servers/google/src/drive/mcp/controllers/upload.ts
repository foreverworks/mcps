import { z } from "zod";

import { uploadFile } from "../../app/usecases/upload.js";
import { IF_EXISTS, type IfExists } from "../../domain/upload.js";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

export const registerUpload: Registrar = (server, deps) => {
  const mirror =
    deps.mirror === undefined
      ? ""
      : `A file in the local copy of My Drive (${deps.mirror}) is read where it is, no copy needed, and goes to the folder it ` +
        "mirrors unless folder_id or folder_path says otherwise: work done in the mirror is published at once " +
        "instead of at the next sync. ";
  server.registerTool(
    "upload_file",
    {
      title: "Upload a file to Drive",
      description:
        "Put a file on Drive byte for byte and prove it: after the upload, Drive's own checksum of what it " +
        "stored (or the bytes read back, when Drive reports none) is compared with the source's. A difference " +
        "fails the call and is taken back: a replacement's damaged revision is deleted, a new file is trashed. The file goes as path " +
        `(${deps.readInput.where}) or as content_base64 with its sha256. ${deps.readInput.help} ${mirror}` +
        "The folder is folder_id, else folder_path, else the root. A name already in the folder is refused " +
        "unless if_exists says what to do. A file given by path keeps its modification time on Drive. " +
        "Returns the stored file with its link, size, sha256, md5 and verifiedBy. With convert, an Office file " +
        "(.docx, .doc, .xlsx, .xls, .csv, .pptx, .ppt) becomes a Google Doc, Sheet or deck instead, named without its " +
        "extension; a converted file keeps no bytes to compare, so the check is that " +
        "Drive made the Google type, and the result gives the source's size and sha256 under `source`.",
      inputSchema: {
        path: z.string().optional().describe(`The file as ${deps.readInput.where}. Links are refused.`),
        content_base64: z
          .string()
          .optional()
          .describe("The bytes as standard base64, only as a script that read the file wrote them, never typed. Needs sha256 and filename."),
        sha256: z.string().optional().describe("Hex SHA-256 of the source file. Required with content_base64, checked with path."),
        folder_id: z.string().default("").describe("The destination folder's id. Takes precedence over folder_path."),
        folder_path: z.string().default("").describe("The destination folder's path under My Drive; empty is the root."),
        filename: z.string().default("").describe("The name on Drive; defaults to the file's (the same key a Gmail attachment takes)."),
        mime_type: z.string().default("").describe("Defaults to a guess from the name."),
        if_exists: z
          .enum(IF_EXISTS)
          .default("fail")
          .describe('A file of that name already there: "fail" (default), "replace" (new revision, same id), or "keep_both".'),
        convert: z.boolean().default(false).describe("Upload an Office file as the Google Doc, Sheet or deck it converts to. Default false: the bytes as they are."),
      },
    },
    handled(
      (args: {
        path?: string | undefined;
        content_base64?: string | undefined;
        sha256?: string | undefined;
        folder_id: string;
        folder_path: string;
        filename: string;
        mime_type: string;
        if_exists: IfExists;
        convert: boolean;
      }) =>
        uploadFile(deps, {
          source: { path: args.path, contentBase64: args.content_base64, sha256: args.sha256, name: args.filename || undefined },
          folderId: args.folder_id,
          folderPath: args.folder_path,
          name: args.filename,
          mimeType: args.mime_type,
          ifExists: args.if_exists,
          convert: args.convert,
        }),
    ),
  );
};
