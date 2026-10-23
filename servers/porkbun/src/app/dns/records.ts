import type { FileSource } from "@foreverworks/mcp-kit";

import { spfProblems } from "../../domain/dns/spf.js";
import { parseZone } from "../../domain/dns/zoneFile.js";
import { isDkim, isSpf, txtText } from "../../domain/dns/txt.js";
import { fail, inputError } from "../../domain/errors.js";
import { annotated, callTool } from "../callTool.js";
import type { Deps, ToolArgs } from "../ports.js";
import { dkimProblem } from "./dkim.js";

/**
 * DNS records whose content is checked before Porkbun publishes it: a TXT
 * record that is a DKIM key must hold a key, one that is an SPF record must
 * parse. Both are long text a model types or copies, and a wrong one fails
 * silently at every mail receiver, not at the registrar.
 */

/** One record as the vendor's tools take it. */
export type DnsRecord = { readonly name?: string | undefined; readonly type?: string | undefined; readonly content?: string | undefined };

/** What is wrong with a record's content; empty when nothing is, or when it is not a TXT record this server reads. */
export const recordProblems = (record: DnsRecord): readonly string[] => {
  if (record.content === undefined) return [];
  if (record.type !== undefined && record.type.toUpperCase() !== "TXT") return [];
  const text = txtText(record.content);
  if (isSpf(text)) return spfProblems(text).map((p) => `SPF: ${p}`);
  if (isDkim(record.name, text)) {
    const problem = dkimProblem(text);
    return problem === undefined ? [] : [`DKIM: ${problem}`];
  }
  return [];
};

const text = (value: unknown): string | undefined => (typeof value === "string" ? value : undefined);

/** create_dns_record and update_dns_record: the vendor's tool, once the content passed. */
export const writeCheckedRecord = async (deps: Deps, tool: string, args: ToolArgs, revealsSecrets: boolean): Promise<unknown> => {
  const problems = recordProblems({ name: text(args["name"]), type: text(args["type"]), content: text(args["content"]) });
  if (problems.length > 0) return fail(inputError(`content: ${problems.join("; ")}; nothing was sent`));
  return callTool(deps, tool, args, revealsSecrets);
};

/**
 * import_dns_records with its records given inline, read from a file (a JSON
 * array of records, or an object with one under `records`, or a BIND zone
 * file, through the kit's reader, so hundreds of records are not retyped), or
 * none of these (Porkbun scans the domain). Every record is checked before
 * any is sent, a zone file's records as the vendor's own schema reads them.
 */
export const importDnsRecords = async (
  deps: Deps,
  args: { readonly domain: string; readonly records?: readonly DnsRecord[]; readonly recordsFile?: FileSource; readonly zoneFile?: FileSource },
  parseRecords: (value: unknown) => readonly DnsRecord[],
  revealsSecrets: boolean,
): Promise<unknown> => {
  const given = [args.records !== undefined && "records", args.recordsFile !== undefined && "records_file", args.zoneFile !== undefined && "zone_file"].filter((g) => g !== false);
  if (given.length > 1) return fail(inputError(`give one of records, records_file and zone_file, not ${given.join(" and ")}`));
  const source = await recordsFrom(deps, args, parseRecords);
  const records = source?.records ?? args.records;
  const problems = (records ?? []).flatMap((record, i) => recordProblems(record).map((p) => `${source?.where(i) ?? `record ${i + 1}`} (${record.type ?? "?"} ${record.name || "@"}): ${p}`));
  if (problems.length > 0) return fail(inputError(`${problems.join("; ")}; nothing was imported`));
  const result = await callTool(deps, "import_dns_records", { domain: args.domain, ...(records === undefined ? {} : { records }) }, revealsSecrets);
  return source === undefined ? result : annotated(result, source.said);
};

/** The records a file holds, how to name the i-th one in a problem, and what the answer says about the file. */
type FromFile = { readonly records: readonly DnsRecord[]; readonly where: (i: number) => string; readonly said: Readonly<Record<string, unknown>> };

const recordsFrom = async (
  deps: Deps,
  args: { readonly domain: string; readonly recordsFile?: FileSource; readonly zoneFile?: FileSource },
  parseRecords: (value: unknown) => readonly DnsRecord[],
): Promise<FromFile | undefined> => {
  if (args.recordsFile !== undefined) {
    const file = await deps.files(args.recordsFile);
    const records = parseRecords(jsonOf(file.bytes));
    return { records, where: (i) => `record ${i + 1}`, said: { records_file: { sha256: file.sha256, size: file.size, records: records.length } } };
  }
  if (args.zoneFile !== undefined) {
    const file = await deps.files(args.zoneFile);
    const zone = parseZone(file.bytes.toString("utf8"), args.domain);
    if (!zone.ok) return fail(inputError(`zone_file: ${zone.problems.slice(0, 10).join("; ")}${zone.problems.length > 10 ? `; and ${String(zone.problems.length - 10)} more` : ""}; nothing was imported`));
    if (zone.records.length === 0) return fail(inputError("zone_file holds no record Porkbun imports; nothing was imported"));
    const records = parseRecords(zone.records);
    return {
      records,
      where: (i) => `record ${i + 1} of the zone file`,
      said: { zone_file: { sha256: file.sha256, size: file.size, records: records.length, ignored: zone.ignored } },
    };
  }
  return undefined;
};

/** The file's records: a JSON array, or an object holding one under `records` (what an export usually writes). */
const jsonOf = (bytes: Buffer): unknown => {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8").replace(/^﻿/, ""));
  } catch (cause) {
    return fail(inputError(`records_file is not JSON: ${(cause as Error).message}`));
  }
  const nested = typeof value === "object" && value !== null && !Array.isArray(value) ? (value as { readonly records?: unknown }).records : undefined;
  return nested ?? value;
};
