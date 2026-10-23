import { compact } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { downloadFiles, uploadFile } from "../../app/usecases/files.js";
import { MAX_DOWNLOAD_BYTES, MAX_UPLOAD_BYTES } from "../../domain/files.js";
import { account, page } from "../args.js";
import { handled } from "../envelope.js";
import type { ArgsOf, Registrar } from "./types.js";

const MIB = 1024 * 1024;

/** Files in and out of a page: in by path, out through the outbox, each with its SHA-256. */
export const registerFiles: Registrar = (server, deps) => {
  const UPLOAD = {
    page,
    file: z
      .object({
        path: z.string().optional().describe(`A path: ${deps.readInput.where}. Links are refused.`),
        content_base64: z.string().optional().describe("The bytes as standard base64, only as a script that read the file wrote them, never typed. Needs sha256."),
        sha256: z.string().optional().describe("Hex SHA-256 of the source file, as sha256sum prints it. Required with content_base64, checked with path."),
      })
      .describe(`The file, up to ${MAX_UPLOAD_BYTES / MIB} MiB (Notion's Free plan takes 5 MiB a file). ${deps.readInput.help}`),
    column: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("A files column of the row to add it to, after the files already there. Leave it out to put it in a block at the end of the page's body."),
    name: z.string().trim().min(1).max(200).optional().describe("The name Notion shows. Default: the file's own name."),
    replace: z
      .boolean()
      .default(false)
      .describe("With column: drop the column's Notion-hosted files, which the API cannot write back. Its external links are always kept."),
    account,
  };

  const DOWNLOAD = {
    page,
    column: z.string().trim().min(1).optional().describe("Only this files column; the body is then left alone."),
    body: z.boolean().default(true).describe("Also the files in the page's body: file, image, PDF, video and audio blocks, nested ones included."),
    save_dir: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe("A folder inside the outbox, e.g. \"2026-10/contracts\". Default: a folder named after the page's id."),
    account,
  };

  server.registerTool(
    "upload_file",
    {
      title: "Upload a file to a page",
      description:
        "Upload a file to Notion and attach it to a page: to one of a row's files columns, or as a block at the end of the " +
        "page's body (an image, PDF, video or sound shows as such). The file goes by path, never as text you type. Answers " +
        "with its size and SHA-256 as sent: compare them with the source. A column's own Notion-hosted files are kept unless " +
        "the API cannot write them back, which is refused unless replace says so; nothing is uploaded before every check passes.",
      inputSchema: UPLOAD,
    },
    handled((args: ArgsOf<typeof UPLOAD>) =>
      uploadFile(deps, {
        page: args.page,
        file: { path: args.file.path, contentBase64: args.file.content_base64, sha256: args.file.sha256 },
        replace: args.replace,
        ...compact({ column: args.column, name: args.name, account: args.account }),
      }),
    ),
  );

  server.registerTool(
    "download_files",
    {
      title: "Download a page's files",
      description:
        "Save the files Notion hosts for a page to this server's outbox: its files columns and the file blocks of its body " +
        `(up to ${MAX_DOWNLOAD_BYTES / MIB} MiB each). Answers each file's path, size and SHA-256, and where it was on the ` +
        "page. External links are listed, not fetched. A file that fails is listed with why, beside the others.",
      inputSchema: DOWNLOAD,
    },
    handled((args: ArgsOf<typeof DOWNLOAD>) =>
      downloadFiles(deps, { page: args.page, body: args.body, ...compact({ column: args.column, saveDir: args.save_dir, account: args.account }) }),
    ),
  );
};
