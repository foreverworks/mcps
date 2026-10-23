import { z } from "zod";

import { saveSslBundle } from "../../app/sslBundle.js";
import { OUTBOX_VARIABLE } from "../../domain/errors.js";
import { expectVendorTakes, vendorArg, type Wrapper } from "./offered.js";

/**
 * get_ssl_bundle as this server offers it: the bundle saved to the outbox
 * (app/sslBundle.ts) instead of returned, so the private key never enters the
 * conversation. It stays `money` in the policy, the class a client confirms
 * with its user: whoever reads the outbox holds the key, so the call is still
 * one that hands a secret out. A policy that stopped classifying it so stops
 * the server here.
 */

const where = (outbox: string | undefined): string =>
  outbox === undefined
    ? `This server has no outbox yet (${OUTBOX_VARIABLE}), so the call fails until one is set.`
    : `The files go in ${outbox}, or a folder inside it named by save_dir.`;

export const sslBundleTool: Wrapper = (deps, vendor, revealsSecrets) => {
  if (!revealsSecrets) throw new Error("porkbun: get_ssl_bundle saves a certificate's private key, so src/mcp/policy.ts must keep it money");
  expectVendorTakes(vendor, { domain: "example.com" }, "src/mcp/register/sslBundle.ts");
  return {
    description:
      "Save a domain's free Porkbun-issued TLS certificate and its private key in this server's outbox, instead of returning the key. " +
      "The certificate is Let's Encrypt's, provisioned for domains on Porkbun's nameservers. The files are `<domain>.fullchain.pem` " +
      "(the chain) and `<domain>.privkey.pem` (the key), mode 0640 (owner and the outbox's group); the key is checked against the certificate first, and nothing is " +
      "saved when it is not the certificate's. The answer gives each file's path, size and sha256, and the certificate's subject, " +
      `names, issuer and validity. Install the files from there on the server that terminates TLS. ${where(deps.outbox)}`,
    inputSchema: {
      domain: vendorArg(vendor, "domain", z.string().min(3)),
      save_dir: z.string().optional().describe("A folder inside the outbox to save into (created if missing). Default: the outbox itself."),
    },
    run: (args) => {
      const saveDir = args["save_dir"];
      return saveSslBundle(deps, { domain: String(args["domain"]), ...(typeof saveDir === "string" ? { saveDir } : {}) });
    },
  };
};
