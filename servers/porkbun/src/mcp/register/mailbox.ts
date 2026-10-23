import { withPasswordSaved } from "../../app/mailboxPassword.js";
import { expectVendorTakes, type Wrapper } from "./offered.js";

/**
 * create_mailbox and setup_mailbox: the vendor's tool, with a password
 * Porkbun generates saved in the outbox instead of returned
 * (app/mailboxPassword.ts). Both stay `money`: whoever reads the outbox has
 * the mailbox, as with get_ssl_bundle's key.
 */

const NOTE =
  "\n\nOn this server a password Porkbun generates is not returned: it is saved in this server's outbox as `<address>.password` " +
  "(owner and group only) and the answer's `password` says where, so the call needs the outbox. A password passed in the call " +
  "goes through the conversation; leaving it out keeps it there only for whoever reads the file.";

export const mailboxTool: Wrapper = (deps, vendor, revealsSecrets) => {
  if (!revealsSecrets) throw new Error(`porkbun: ${vendor.name} sets up a mailbox and its password, so src/mcp/policy.ts must keep it money`);
  expectVendorTakes(vendor, { domain: "example.com", address: "me", ...(vendor.name === "create_mailbox" ? { cost_cents: 3600 } : {}) }, "src/mcp/register/mailbox.ts");
  return {
    description: `${vendor.description}${NOTE}`,
    inputSchema: vendor.inputSchema,
    run: (args) => withPasswordSaved(deps, vendor.name, args, revealsSecrets),
  };
};
