import type { InputFiles } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { AttachmentInput, ComposeInput } from "../../app/usecases/compose.js";

/**
 * The composing inputs every write tool shares, so their wording cannot drift
 * between create_draft, reply, forward and send_message.
 */
const addresses = (what: string) =>
  z
    .array(z.string())
    .optional()
    .describe(`${what}. Each entry is an address, "Name <address>", or a comma-separated list of those.`);

/**
 * How a file gets here, in the words of the server's own reader (mcp-kit
 * inputFile.ts): where a path may point and how else to send one, derived from
 * MCP_FILE_ROOTS and MCP_FILE_SCRIPT, so a service names the folder it reads
 * and a stdio user's names their working directory. A tool call's arguments are
 * written by the model, so a file typed into one as base64 can arrive one
 * character wrong; a path, or base64 a script wrote with its sha256, cannot.
 */
export const attachmentArg = (files: InputFiles) =>
  z.array(
    z.object({
      path: z
        .string()
        .optional()
        .describe(`${files.where}. Links are refused. Exactly one of path or content_base64.`),
      content_base64: z
        .string()
        .optional()
        .describe("The bytes as standard base64, only as a script that read the file wrote them, never typed. Needs sha256 and filename."),
      sha256: z
        .string()
        .optional()
        .describe("Hex SHA-256 of the source file, as sha256sum prints it. Required with content_base64, checked with path; a mismatch fails as checksum_mismatch and nothing is sent."),
      filename: z.string().optional().describe("Defaults to the path's basename."),
      mime_type: z.string().optional().describe("Defaults to a guess from the extension."),
    }),
  );

export const composeShape = (files: InputFiles) => ({
  to: addresses("Recipients"),
  cc: addresses("Cc recipients"),
  bcc: addresses("Bcc recipients (kept on a draft, stripped from what recipients see)"),
  subject: z.string().optional(),
  body_text: z
    .string()
    .optional()
    .describe(
      "Plain-text body: write paragraphs as single lines, never hard-wrapped. Given alone, an HTML alternative with the same lines is generated, so Gmail renders it as ordinary prose.",
    ),
  body_html: z
    .string()
    .optional()
    .describe("HTML body. Given alone, a plain-text alternative is generated from it; give both to control each."),
  attachments: attachmentArg(files)
    .optional()
    .describe(`Files to attach. ${files.help} The result lists each attachment's sha256 and size: compare them with the source.`),
  from: z
    .string()
    .optional()
    .describe("Send as this address. It must be one of the account's verified send-as aliases; defaults to the account's default."),
});

export type ComposeArgs = {
  to?: string[] | undefined;
  cc?: string[] | undefined;
  bcc?: string[] | undefined;
  subject?: string | undefined;
  body_text?: string | undefined;
  body_html?: string | undefined;
  attachments?:
    | {
        path?: string | undefined;
        content_base64?: string | undefined;
        sha256?: string | undefined;
        filename?: string | undefined;
        mime_type?: string | undefined;
      }[]
    | undefined;
  from?: string | undefined;
};

const attachmentsFrom = (list: ComposeArgs["attachments"]): readonly AttachmentInput[] | undefined =>
  list?.map((a) => ({
    ...(a.path ? { path: a.path } : {}),
    ...(a.content_base64 !== undefined ? { contentBase64: a.content_base64 } : {}),
    ...(a.sha256 ? { sha256: a.sha256 } : {}),
    ...(a.filename ? { filename: a.filename } : {}),
    ...(a.mime_type ? { mimeType: a.mime_type } : {}),
  }));

/** snake_case tool arguments to the use case's input, dropping what was not given. */
export const composeInput = (a: ComposeArgs): ComposeInput => {
  const attachments = attachmentsFrom(a.attachments);
  return {
    ...(a.to ? { to: a.to } : {}),
    ...(a.cc ? { cc: a.cc } : {}),
    ...(a.bcc ? { bcc: a.bcc } : {}),
    ...(a.subject !== undefined ? { subject: a.subject } : {}),
    ...(a.body_text !== undefined ? { bodyText: a.body_text } : {}),
    ...(a.body_html !== undefined ? { bodyHtml: a.body_html } : {}),
    ...(attachments ? { attachments } : {}),
    ...(a.from ? { from: a.from } : {}),
  };
};

/** The sentence every tool that can send carries, in one place. */
export const OUTWARD =
  "SENDING IS OUTWARD-FACING AND CANNOT BE UNDONE: only send when the user has explicitly approved THIS message " +
  "(its recipients and its text) in the current conversation. Otherwise create a draft and give the user its webUrl.";
