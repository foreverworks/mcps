import { summaryFrom, type ToolArgs, type ToolPolicy } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { filingOf } from "../app/usecases/declarations.js";
import { submitInput } from "./controllers/declarations.js";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts).
 *
 * - read: nothing changes at ANAF. The listing, the downloads (written into
 *   this server's own outbox), sync (which also notes what it saved), the
 *   posting dates (read from the alert e-mails), waiting for a reply, the
 *   request form's types, health and status.
 * - write: the session tools change what the server holds, and a sign-in
 *   makes SPV e-mail a code; request_document registers a request at ANAF,
 *   which costs nothing and makes no legal document (SPV only answers it);
 *   submit_contact_form sends a message to ANAF under the account's name
 *   (a dry run unless told otherwise), which ANAF registers and answers.
 *
 * - money: submit_declaration files a declaration, a fiscal document that
 *   cannot be withdrawn, only rectified. The line a person confirms is read
 *   from the PDF itself (`resolve` reads it once, with the same check the
 *   filing makes), so it names the form, the year and the taxpayer of the
 *   bytes that will be sent, never just a file's name.
 * - read: validate_declaration runs ANAF's validator here and files nothing;
 *   declaration_status reads ANAF's public status page and saves a receipt
 *   to the outbox.
 */
const resolvedSubmit = z.object({ ...submitInput(""), filing_line: z.string().min(1) });

export const policyFor = (deps: Deps): ToolPolicy => ({
  ...policy,
  submit_declaration: {
    access: "money",
    summary: summaryFrom(resolvedSubmit, (args) => args.filing_line),
    resolve: async (args: ToolArgs) => {
      const path = typeof args["pdf"] === "string" ? args["pdf"] : "";
      const sha = typeof args["pdf_sha256"] === "string" ? args["pdf_sha256"].toLowerCase() : undefined;
      const { line } = await filingOf(deps, { path, sha256: sha });
      return { ...args, filing_line: line };
    },
  },
});

/** Every tool but the one whose confirmation line needs the server's files (policyFor adds it). */
export const policy: ToolPolicy = {
  health: { access: "read" },
  session_status: { access: "read" },
  login: { access: "write" },
  complete_login: { access: "write" },
  logout: { access: "write" },
  list_messages: { access: "read" },
  download_message: { access: "read" },
  sync_messages: { access: "read" },
  posting_dates: { access: "read" },
  await_reply: { access: "read" },
  list_document_types: { access: "read" },
  request_document: { access: "write" },
  submit_contact_form: { access: "write" },
  validate_declaration: { access: "read" },
  declaration_status: { access: "read" },
};
