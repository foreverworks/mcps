import { z } from "zod";

import { createDnssecRecord, type DnssecArgs } from "../../app/dns/dnssec.js";
import { expectVendorTakes, type Wrapper } from "./offered.js";

/**
 * create_dnssec_record as this server offers it: the vendor's tool, with the
 * DS computed from the zone's DNSKEY when the caller gives one, and checked
 * for shape when it does not (app/dns/dnssec.ts). The four DS fields become
 * optional, since a DNSKEY implies them.
 */

const DS_FIELDS = ["keyTag", "alg", "digestType", "digest"] as const;

export const dnssecTool: Wrapper = (deps, vendor, revealsSecrets) => {
  expectVendorTakes(vendor, { domain: "example.com", keyTag: "2371", alg: "13", digestType: "2", digest: "0".repeat(64) }, "src/mcp/register/dnssec.ts");
  const optional = Object.fromEntries(DS_FIELDS.map((f) => [f, (vendor.inputSchema[f] ?? z.string()).optional()]));
  return {
    description:
      `${vendor.description}\n\nOn this server the four DS fields may come from dnskey instead, which is safer: the zone's ` +
      "DNSKEY record as the signer prints it (`example.com. 3600 IN DNSKEY 257 3 13 <base64>`, or just `257 3 13 <base64>`). The DS is computed from it (RFC 4034: the " +
      "key tag, its algorithm, a SHA-256 digest unless digestType says 1 or 4), and any of keyTag, alg, digestType and digest also " +
      "given must agree with it. Without dnskey all four are required and checked before anything is sent: keyTag 0-65535, a known " +
      "algorithm number, a hex digest of its type's length (40 for type 1, 64 for 2, 96 for 4). The answer adds ds, the record as sent.",
    inputSchema: {
      ...vendor.inputSchema,
      ...optional,
      dnskey: z
        .string()
        .optional()
        .describe("The zone's DNSKEY record (a zone-file line, or flags protocol algorithm key), usually the key-signing key (257). The DS is computed from it."),
    },
    run: (args) => createDnssecRecord(deps, args as DnssecArgs, revealsSecrets),
  };
};
