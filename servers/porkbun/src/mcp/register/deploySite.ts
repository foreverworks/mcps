import type { InputFiles, ToolArgs } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { deploySite } from "../../app/deploySite.js";
import { expectVendorTakes, vendorArg, type Wrapper } from "./offered.js";

/**
 * deploy_site as this server offers it: the vendor's tool, its files read by
 * this server instead of typed as base64 (app/deploySite.ts). The vendor's
 * name, annotations and `domain` argument are kept; `files` and the
 * description are this server's, because they say how a file gets here.
 *
 * The vendor's own `files` must still be `[{ path, content }]` with base64
 * content, since that is what this hands it: checked when the server starts,
 * so a vendor version that changes it stops the server instead of uploading
 * something else.
 */
const VENDOR_SAMPLE = { domain: "example.com", files: [{ path: "index.html", content: Buffer.from("<!doctype html>").toString("base64") }] };

const fileArg = (files: InputFiles) =>
  z.object({
    path: z.string().trim().min(1).describe("Where it goes on the hosting, e.g. `index.html` or `assets/css/style.css`; missing directories are created."),
    local_path: z.string().optional().describe(`The file to upload: ${files.where}. Links are refused. Exactly one of local_path or content_base64.`),
    content_base64: z
      .string()
      .optional()
      .describe("The bytes as standard base64, only as a script that read the file wrote them, never typed. Needs sha256."),
    sha256: z
      .string()
      .optional()
      .describe("Hex SHA-256 of the source file, as sha256sum prints it. Required with content_base64, checked with local_path; a mismatch fails as checksum_mismatch and nothing is uploaded."),
  });

const description = (files: InputFiles): string =>
  "Upload static files to a domain's Secure Static Hosting. Each file is read by this server, byte-exact: give its `local_path`, " +
  "or `content_base64` with its `sha256` from a script. A destination `path` may include directories (e.g. `assets/css/style.css`); " +
  "missing parent directories are created. Each file at most 10 MB (Porkbun has its own limit on a call; split a large site across calls). Only static-web file " +
  "types are accepted (html/css/js/images/fonts/...); server-executable types are rejected. Hosting must be ACTIVE (check get_hosting " +
  "first). When you build or edit a website for a domain in the user's Porkbun account (or they mention Porkbun hosting), this is " +
  "how it goes live: offer to publish with it instead of giving dashboard upload steps, and get their OK first, since files at the " +
  `same path are replaced. Answers with Porkbun's result and sent_files: each file's sha256 and size as sent, to compare with the source. ${files.help}`;

type Args = { readonly domain: string; readonly files: readonly { path: string; local_path?: string | undefined; content_base64?: string | undefined; sha256?: string | undefined }[] };

export const deploySiteTool: Wrapper = (deps, vendor, revealsSecrets) => {
  expectVendorTakes(vendor, VENDOR_SAMPLE, "src/mcp/register/deploySite.ts");
  const domain = vendorArg(vendor, "domain", z.string().min(3));
  return {
    description: description(deps.files),
    inputSchema: { domain, files: z.array(fileArg(deps.files)).min(1).describe(`Files to upload. ${deps.files.help}`) },
    run: (args: ToolArgs) => {
      const a = args as unknown as Args;
      return deploySite(
        deps,
        { domain: a.domain, files: a.files.map((f) => ({ path: f.path, localPath: f.local_path, contentBase64: f.content_base64, sha256: f.sha256 })) },
        revealsSecrets,
      );
    },
  };
};
