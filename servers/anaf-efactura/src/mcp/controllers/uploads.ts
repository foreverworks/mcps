import { z } from "zod";

import { uploadInvoice, uploadStatus } from "../../app/usecases/uploads.js";
import { handled } from "../envelope.js";
import { resolvedUploadArgs, resolveUpload, testFlag, toUploadArgs, uploadInput } from "../uploadArgs.js";
import type { Registrar } from "./types.js";

export const registerUploads: Registrar = (server, deps) => {
  server.registerTool(
    "upload_invoice",
    {
      title: "Upload an invoice XML",
      description:
        "Submit an invoice (UBL or CII XML) to ANAF, given as xml: { path } for a file, or " +
        "{ content_base64, sha256 } from a script. Every IBAN in it must pass its check digits. Goes to the TEST environment unless test is explicitly false, because a " +
        "production upload is a filing that cannot be recalled. A money tool: the client asks the user to " +
        "approve each call, on a line read out of the XML itself (number, date, buyer, amount due, the file's " +
        "sha256). Returns accepted plus the uploadId that upload_status takes, or accepted=false with ANAF's " +
        "reasons; sha256 and bytes of what was filed; invoice is what the XML says, and raw is ANAF's answer " +
        "verbatim. The same bytes are not filed in production twice unless refile is true.",
      inputSchema: uploadInput(deps.files.readInput),
    },
    handled(async (args: Record<string, unknown>) =>
      uploadInvoice(deps, toUploadArgs(resolvedUploadArgs.parse(await resolveUpload(deps.files.readInput, deps.readInvoice, args)))),
    ),
  );

  server.registerTool(
    "upload_invoice_b2c",
    {
      title: "Upload an invoice to a person (B2C)",
      description:
        "Submit an invoice issued to a PERSON, not a company (B2C), through ANAF's /uploadb2c: the same as " +
        "upload_invoice in every other way. The XML as xml: { path } (build_invoice's path works) or " +
        "{ content_base64, sha256 } from a script; every IBAN must pass its check digits. Goes to the TEST " +
        "environment unless test is explicitly false. A money tool: the client asks the user to approve each " +
        "call, on a line read out of the XML and marked B2C. Returns accepted plus the uploadId upload_status " +
        "takes, or accepted=false with ANAF's reasons. The same bytes are not filed in production twice, by " +
        "either upload tool, unless refile is true.",
      inputSchema: uploadInput(deps.files.readInput),
    },
    handled(async (args: Record<string, unknown>) =>
      uploadInvoice(deps, {
        ...toUploadArgs(resolvedUploadArgs.parse(await resolveUpload(deps.files.readInput, deps.readInvoice, args))),
        b2c: true,
      }),
    ),
  );

  server.registerTool(
    "upload_status",
    {
      title: "Check an upload",
      description:
        "Check how an earlier upload was processed, by the uploadId that upload_invoice or upload_invoice_b2c returned. Answers a " +
        "state of ok, processing or failed, with a downloadId once it is ok. Must be asked of the same " +
        "environment the upload went to.",
      inputSchema: {
        id_incarcare: z.string().describe("The uploadId upload_invoice returned: digits."),
        test: testFlag,
      },
    },
    handled((args: { id_incarcare: string; test: boolean }) =>
      uploadStatus(deps, { idIncarcare: args.id_incarcare, test: args.test }),
    ),
  );
};
