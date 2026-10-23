import type { McpServer, ToolPolicy } from "@foreverworks/mcp-kit";

import { callTool } from "../app/callTool.js";
import type { Deps, ToolArgs, ToolSpec } from "../app/ports.js";
import { checkSpendLimit } from "../app/spendLimit.js";
import { CHARGED_NOW } from "../domain/charges.js";
import { WITHHELD_SECRET } from "../domain/secrets.js";
import { deploySiteTool } from "./register/deploySite.js";
import { checkedRecordTool, importRecordsTool, nameserversTool } from "./register/dns.js";
import { dnssecTool } from "./register/dnssec.js";
import { handled } from "./register/envelope.js";
import { invoicePdfTool } from "./register/invoicePdf.js";
import { mailboxTool } from "./register/mailbox.js";
import type { OfferedTool, OwnTool, Wrapper } from "./register/offered.js";
import { sslBundleTool } from "./register/sslBundle.js";
import { zoneExportTool } from "./register/zoneExport.js";

const WITHHELD_NOTE = `\n\nOn this server a secret field in the result is ${WITHHELD_SECRET}.`;

/**
 * The vendor tools this server does not relay as they are, because a model
 * would otherwise have to get exact bytes right with nothing to notice when it
 * did not (files, keys, digests), or would receive a private key, a
 * generated password or a whole file in the conversation.
 */
export const WRAPPED: Readonly<Record<string, Wrapper>> = {
  deploy_site: deploySiteTool,
  get_ssl_bundle: sslBundleTool,
  get_invoice_pdf: invoicePdfTool,
  create_mailbox: mailboxTool,
  setup_mailbox: mailboxTool,
  create_dnssec_record: dnssecTool,
  create_dns_record: checkedRecordTool,
  update_dns_record: checkedRecordTool,
  import_dns_records: importRecordsTool,
  update_nameservers: nameserversTool,
};

/** This server's own tools, offered beside the vendor's (their access is OWN in src/mcp/policy.ts). */
export const OWN_TOOLS: readonly OwnTool[] = [zoneExportTool];

/**
 * The vendor's description, amended where it promises a field this server
 * withholds: the first sentence says so in a parenthesis, because that sentence
 * is what a tool table quotes (scripts/check-docs.ts), and the note at the end
 * says where the secret can be had.
 */
const descriptionOf = (tool: ToolSpec, revealsSecrets: boolean, secretFields: readonly string[]): string => {
  const promised = revealsSecrets ? undefined : secretFields.find((field) => new RegExp(`\\b${field}\\b`, "i").test(tool.description));
  if (promised === undefined) return tool.description;
  const amended = tool.description.replace(/([.!?])(\s|$)/, (_m, end: string, after: string) => ` (its ${promised} is withheld on this server)${end}${after}`);
  return `${amended}${WITHHELD_NOTE}`;
};

const relayed = (deps: Deps, tool: ToolSpec, revealsSecrets: boolean): OfferedTool => ({
  description: descriptionOf(tool, revealsSecrets, deps.porkbun.secretFields),
  inputSchema: tool.inputSchema,
  run: (args: ToolArgs) => callTool(deps, tool.name, args, revealsSecrets),
});

/**
 * A tool that charges now (src/domain/charges.ts) reads the account's monthly
 * caps first and is refused, with nothing sent, when the charge would go over
 * what is left (app/spendLimit.ts).
 */
const capChecked = (deps: Deps, name: string, offered: OfferedTool): OfferedTool =>
  Object.hasOwn(CHARGED_NOW, name)
    ? {
        ...offered,
        description: `${offered.description}${CAP_NOTE}`,
        run: async (args) => {
          await checkSpendLimit(deps, name, args);
          return offered.run(args);
        },
      }
    : offered;

const CAP_NOTE =
  "\n\nOn this server the account's monthly API caps are read first (get_api_settings), and a charge over what is left of them " +
  "is refused with the figures (`over_limit`, carrying Porkbun's own code) before anything is sent. A dry run is not checked: " +
  "Porkbun's dry run reports the cap itself.";

/**
 * Every tool the vendor offers, on the server `serve` hands us: the vendor's
 * name and annotations, its handler behind this server's envelope, so a result
 * is compact JSON and a failure is `{ error: { kind, message, remedy } }`. The
 * tools in WRAPPED take their arguments or give their answer differently
 * (register/*.ts).
 *
 * A secret field reaches a result only from a `money` tool, the class a client
 * asks its user to approve (or the server asks, MCP_CONFIRM=elicit).
 */
export const registerAll = (server: McpServer, deps: Deps, policy: ToolPolicy): void => {
  for (const tool of deps.porkbun.catalog) {
    const revealsSecrets = policy[tool.name]?.access === "money";
    const offered = capChecked(deps, tool.name, (WRAPPED[tool.name] ?? relayed)(deps, tool, revealsSecrets));
    server.registerTool(tool.name, { description: offered.description, inputSchema: offered.inputSchema, annotations: tool.annotations }, handled(offered.run));
  }
  for (const own of OWN_TOOLS) {
    const offered = own.make(deps);
    server.registerTool(own.name, { description: offered.description, inputSchema: offered.inputSchema, annotations: own.annotations }, handled(offered.run));
  }
};
