import { z } from "zod";

import { exportDnsZone } from "../../app/dns/zoneFile.js";
import { OUTBOX_VARIABLE } from "../../domain/errors.js";
import type { OwnTool } from "./offered.js";

/**
 * export_dns_zone, this server's own tool: a domain's records as a BIND zone
 * file in the outbox (app/dns/zoneFile.ts). Porkbun's API lists records but
 * writes no zone file, and its package has no tool for one.
 */

const where = (outbox: string | undefined): string =>
  outbox === undefined
    ? `This server has no outbox yet (${OUTBOX_VARIABLE}), so the call fails until one is set.`
    : `The file goes in ${outbox}, or a folder inside it named by save_dir, as \`<domain>.zone\`.`;

export const zoneExportTool: OwnTool = {
  name: "export_dns_zone",
  annotations: { destructiveHint: false, openWorldHint: false },
  make: (deps) => ({
    description:
      "Save a domain's DNS records as a BIND zone file (RFC 1035) in this server's outbox: every record list_dns_records returns, " +
      "under `$ORIGIN <domain>.`, host names absolute, MX and SRV with their priority, TXT text quoted in 255-byte strings, each " +
      "record's notes as a comment. Porkbun answers with its own SOA, so the file has none. The answer gives the file's path, size " +
      "and sha256, and how many records of each type it holds. Use it as a backup before a large change, or to move the zone to " +
      `another DNS host; import_dns_records takes the file back with \`zone_file\`. ${where(deps.outbox)}`,
    inputSchema: {
      domain: z.string().min(3).describe("A domain in the account, e.g. `example.com`."),
      save_dir: z.string().optional().describe("A folder inside the outbox to save into (created if missing). Default: the outbox itself."),
    },
    run: (args) => {
      const saveDir = args["save_dir"];
      return exportDnsZone(deps, { domain: String(args["domain"]), ...(typeof saveDir === "string" ? { saveDir } : {}) });
    },
  }),
};
