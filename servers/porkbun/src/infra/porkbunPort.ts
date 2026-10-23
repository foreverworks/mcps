import type { PorkbunPort, ToolArgs } from "../app/ports.js";
import { fail } from "../domain/errors.js";
import { classifyVendorError } from "./porkbunPort/vendorErrors.js";
import { OFFERED_TOOLS, SECRET_FIELDS, VENDOR_VERSION, type VendorConfig, withholdSecrets } from "./vendor.js";

/**
 * The vendor's tools, run with the config this server built. The handler is
 * the vendor's own code; what is ours is where its key pair comes from and how
 * its failures are reported.
 */
export const makePorkbunPort = (config: () => Promise<VendorConfig>): PorkbunPort => {
  const handlers = new Map(OFFERED_TOOLS.map((tool) => [tool.name, tool.handler]));

  const run = async (name: string, args: ToolArgs): Promise<unknown> => {
    const handler = handlers.get(name);
    if (handler === undefined) return fail({ kind: "refused", message: `no tool ${name}` });
    const resolved = await config();
    try {
      return await handler(resolved, args);
    } catch (thrown: unknown) {
      const known = classifyVendorError(thrown);
      if (known === undefined) throw thrown;
      return fail(known);
    }
  };

  return {
    vendorVersion: VENDOR_VERSION,
    catalog: OFFERED_TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })),
    run,
    secretFields: SECRET_FIELDS,
    withholdSecrets,
  };
};
