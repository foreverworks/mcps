import { issuesText, resolveSaveDir, saveToOutbox, unsetPath } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { hostnameProblem, normalHostname } from "../../domain/dns/hostname.js";
import { zoneText } from "../../domain/dns/zoneFile.js";
import { fail, inputError, OUTBOX_VARIABLE } from "../../domain/errors.js";
import { callTool } from "../callTool.js";
import type { Deps } from "../ports.js";

/**
 * export_dns_zone: a domain's records as Porkbun lists them
 * (list_dns_records), written as a BIND zone file in the outbox. The answer
 * is the file's path, size and SHA-256 and how many records of each type it
 * holds; import_dns_records takes the file back (`zone_file`).
 */

const ListedSchema = z.looseObject({
  records: z.array(
    z.looseObject({
      name: z.string(),
      type: z.string(),
      content: z.string(),
      ttl: z.union([z.string(), z.number()]).nullish(),
      prio: z.union([z.string(), z.number()]).nullish(),
      notes: z.string().nullish(),
    }),
  ),
});

export const exportDnsZone = async (deps: Deps, args: { readonly domain: string; readonly saveDir?: string }) => {
  const outbox = deps.outbox ?? fail({ kind: "config", variable: OUTBOX_VARIABLE, message: unsetPath(OUTBOX_VARIABLE) });
  const domain = normalHostname(args.domain);
  const problem = hostnameProblem(domain);
  if (problem !== undefined) return fail(inputError(`domain: ${problem}`));
  const where = resolveSaveDir(outbox, args.saveDir);
  if (!where.ok) return fail(inputError(where.reason));

  const listed = ListedSchema.safeParse(await callTool(deps, "list_dns_records", { domain }, false));
  if (!listed.success) return fail({ kind: "drift", message: `list_dns_records answered without the records this server writes (${issuesText(listed.error)}); nothing was saved` });
  const zone = zoneText(domain, listed.data.records);
  const { path, size, sha256 } = await saveToOutbox(where.dir, `${domain}.zone`, zone.text);
  return { domain, file: { path, size, sha256, contentType: "text/dns" }, records: listed.data.records.length, types: zone.types };
};
