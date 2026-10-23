import { z } from "zod";

import { downloadFile } from "../../app/usecases/download.js";
import { DOWNLOAD_FORMATS } from "../../domain/download.js";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

export const registerDownload: Registrar = (server, deps) => {
  const where = deps.downloads === undefined ? "this server's downloads folder (none is configured here)" : deps.downloads.dir;
  server.registerTool(
    "download_file",
    {
      title: "Download a file from Drive",
      description:
        `Save a file from Drive into ${where}, which you can read, and prove it: the bytes are checked against ` +
        "Drive's own checksum before anything is written, so a damaged download is never saved. For a file no " +
        "local copy has yet, or one known only by its id. A Google Doc, Sheet, Slides deck or Drawing has " +
        "no bytes and is exported instead (a Doc as pdf, a Sheet as xlsx, Slides as pptx, a Drawing as png, " +
        "unless format says otherwise). An earlier download of the same name in that folder is replaced. " +
        "Returns the file with the saved path, size, sha256, md5 and verifiedBy (exportedAs for a Google file).",
      inputSchema: {
        file_id: z.string().default("").describe("The file's id. Takes precedence over path."),
        path: z.string().default("").describe('The file\'s path under My Drive, e.g. "Reports/summary.pdf".'),
        format: z
          .enum(["", ...DOWNLOAD_FORMATS])
          .default("")
          .describe("For a Google file only: what to save it as. Empty is its default."),
        save_dir: z.string().default("").describe(`A folder inside ${where} to save into; empty is ${where} itself.`),
        filename: z.string().default("").describe("The saved name; defaults to Drive's, with the export's extension."),
      },
    },
    handled((args: { file_id: string; path: string; format: string; save_dir: string; filename: string }) =>
      downloadFile(deps, { fileId: args.file_id, path: args.path, format: args.format, saveDir: args.save_dir, filename: args.filename }),
    ),
  );
};
