import { z } from "zod";

import { submitContactForm } from "../../app/usecases/contact.js";
import { ATTACHMENT_TYPES, DEFAULT_CATEGORY } from "../../domain/contact.js";
import type { Registrar } from "./types.js";

export const registerContact: Registrar = (server, deps, handled) => {
  server.registerTool(
    "submit_contact_form",
    {
      title: "Write to ANAF (contact form)",
      description:
        "Send a message through SPV's contact form (\"Formular de contact\"): a question or request about the taxpayer's own record, registered at ANAF " +
        "under the account's name and answered later in SPV as RASPUNS SESIZARE FORMULAR UNIC DE CONTACT. By default a DRY RUN: it reads the live " +
        "form, checks the message against it and answers it exactly as it would go (identity, category, text without diacritics, attachment with its " +
        "SHA-256), sending nothing. With dry_run: false it sends, once: it answers the registration number, the date and the text SPV shows. The form " +
        "preselects its first identity, often a company, so cif is required and read back. The same message is not sent twice unless again: true.",
      inputSchema: {
        cif: z.string().trim().regex(/^\d{2,13}$/, "a CNP or CUI, digits only").describe("The tax id to write as: one of the form's identities (the dry run lists them). Required: the form preselects the first."),
        category: z
          .number()
          .int()
          .min(1)
          .max(99)
          .default(DEFAULT_CATEGORY)
          .describe("The form's category. 3 (the default): \"Asistență și îndrumare de specialitate în domeniul fiscal\", the one answered on the merits."),
        subcategory: z.number().int().min(1).max(999).optional().describe("Only for categories 1, 2 and 5, which require one; the error lists them."),
        text: z
          .string()
          .min(1)
          .max(6000)
          .describe("The message. Sent without diacritics (stripped here) and at most 1,500 characters after that; put a longer wording in an attached PDF."),
        attachment: z
          .string()
          .trim()
          .min(1)
          .optional()
          .describe(`A file to attach (${ATTACHMENT_TYPES.join(", ")}, at most 10 MB): ${deps.inputFiles.where}. Taken by path only, byte for byte.`),
        attachment_sha256: z
          .string()
          .trim()
          .regex(/^[0-9a-fA-F]{64}$/)
          .optional()
          .describe("The attachment's hex SHA-256, as sha256sum prints it; a mismatch fails and nothing is sent."),
        dry_run: z.boolean().default(true).describe("true (the default): read the form and check the message, send nothing. false: send it to ANAF."),
        again: z.boolean().default(false).describe("Send even though this same message was sent, or tried, before."),
      },
    },
    handled((args) =>
      submitContactForm(deps, {
        cif: args.cif,
        category: args.category,
        subcategory: args.subcategory,
        text: args.text,
        attachment: args.attachment === undefined ? undefined : { path: args.attachment, sha256: args.attachment_sha256?.toLowerCase() },
        dryRun: args.dry_run,
        again: args.again,
      }),
    ),
  );
};
