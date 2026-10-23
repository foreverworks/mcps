import type { ToolArgs } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { type DnsRecord, importDnsRecords, writeCheckedRecord } from "../../app/dns/records.js";
import { updateNameservers } from "../../app/dns/nameservers.js";
import { fail, inputError } from "../../domain/errors.js";
import { expectVendorTakes, vendorArg, type Wrapper } from "./offered.js";

/**
 * The DNS tools whose arguments this server checks before the vendor's tool
 * sends them (app/dns/): a TXT record's DKIM key or SPF text, a records file,
 * nameserver names. The vendor's schema and description are kept, with a
 * note on what is checked.
 */

const FILE = "src/mcp/register/dns.ts";

const CONTENT_NOTE =
  "\n\nOn this server a TXT record's content is checked before anything is sent: a DKIM key record (v=DKIM1, or p= under " +
  "_domainkey) must hold a public key that parses (an RSA key of 1024 bits or more, or an ed25519 key), and an SPF record " +
  "(v=spf1) must have no obvious mistake (an unknown mechanism, a bad address, a term after all, more than 10 lookups). One " +
  "that fails is refused with what is wrong.";

/** create_dns_record and update_dns_record: the vendor's tool, after the content check. */
export const checkedRecordTool: Wrapper = (deps, vendor, revealsSecrets) => {
  expectVendorTakes(vendor, { domain: "example.com", record_id: "1", type: "TXT", content: "v=spf1 -all" }, FILE);
  return {
    description: `${vendor.description}${CONTENT_NOTE}`,
    inputSchema: vendor.inputSchema,
    run: (args) => writeCheckedRecord(deps, vendor.name, args, revealsSecrets),
  };
};

/** A file argument as the tool takes it. */
type FileArg = { readonly path?: string; readonly content_base64?: string; readonly sha256?: string };

const fileSource = (arg: FileArg) => ({ path: arg.path, contentBase64: arg.content_base64, sha256: arg.sha256 });

/** import_dns_records: records inline, from a JSON file or a zone file, or from a scan. */
export const importRecordsTool: Wrapper = (deps, vendor, revealsSecrets) => {
  const sample = { name: "", type: "TXT", content: "v=spf1 -all" };
  expectVendorTakes(vendor, { domain: "example.com", records: [sample] }, FILE);
  const records = vendorArg(vendor, "records", z.array(z.object({})).optional());
  const parseRecords = (value: unknown): readonly DnsRecord[] => {
    const parsed = records.safeParse(value);
    if (!parsed.success || !Array.isArray(parsed.data)) {
      return fail(inputError(`records_file must hold a JSON array of records ({ name, type, content, ttl?, prio? }): ${parsed.success ? "it holds none" : z.prettifyError(parsed.error)}`));
    }
    return parsed.data as readonly DnsRecord[];
  };
  const fileArg = (what: string, describe: string) =>
    z
      .object({
        path: z.string().optional().describe(`The ${what}: ${deps.files.where}. Links are refused. Exactly one of path or content_base64.`),
        content_base64: z.string().optional().describe("The file's bytes as standard base64, only as a script that read the file wrote them, never typed. Needs sha256."),
        sha256: z.string().optional().describe("Hex SHA-256 of the file, as sha256sum prints it. Required with content_base64, checked with path."),
      })
      .optional()
      .describe(`${describe} ${deps.files.help}`);
  const file = fileArg(
    "records file",
    "Instead of records: a JSON file holding the array (or an object with it under `records`), read byte-exact by this server, " +
      "so a long list is not retyped. The answer adds records_file: its sha256, size and how many records it held.",
  );
  const zone = fileArg(
    "zone file",
    "Instead of records: a BIND zone file (RFC 1035: $ORIGIN, $TTL, @, relative names, parentheses, quoted TXT), such as " +
      "export_dns_zone writes or another DNS host exports, read byte-exact by this server. Its names must be in the domain. SOA, NS " +
      "and DNSSEC records are not imported and are listed in the answer's zone_file.ignored; a type Porkbun cannot hold, $INCLUDE " +
      "or a line that does not parse refuses the whole import, naming the line. The answer adds zone_file: its sha256, size, how " +
      "many records it held and what was ignored.",
  );
  return {
    description:
      `${vendor.description}\n\nOn this server the records may come from a file (records_file, JSON, or zone_file, a BIND zone file) instead of inline, and every ` +
      "record's content is checked before any is sent: a DKIM key must parse, an SPF record must have no obvious mistake. One " +
      "that fails refuses the whole import, naming the record.",
    inputSchema: { ...vendor.inputSchema, records_file: file, zone_file: zone },
    run: (args: ToolArgs) => {
      const source = args["records_file"] as FileArg | undefined;
      const zoneSource = args["zone_file"] as FileArg | undefined;
      const inline = args["records"] as readonly DnsRecord[] | undefined;
      return importDnsRecords(
        deps,
        {
          domain: String(args["domain"]),
          ...(inline === undefined ? {} : { records: inline }),
          ...(source === undefined ? {} : { recordsFile: fileSource(source) }),
          ...(zoneSource === undefined ? {} : { zoneFile: fileSource(zoneSource) }),
        },
        parseRecords,
        revealsSecrets,
      );
    },
  };
};

/** update_nameservers: names checked for syntax, and the answer says what the delegation was and becomes. */
export const nameserversTool: Wrapper = (deps, vendor, revealsSecrets) => {
  expectVendorTakes(vendor, { domain: "example.com", nameservers: ["ns1.example.net", "ns2.example.net"] }, FILE);
  return {
    description:
      `${vendor.description}\n\nOn this server each name is checked for syntax first (a fully qualified host name, no ` +
      "duplicates), and the answer adds nameservers: { before, after }, the set the registry had and the one sent.",
    inputSchema: vendor.inputSchema,
    run: (args) => updateNameservers(deps, args as ToolArgs & { domain: string; nameservers: readonly string[] }, revealsSecrets),
  };
};
