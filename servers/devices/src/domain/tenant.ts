/**
 * Which tenant a caller is, from the client label of the bearer token it presented (mcp-kit's
 * requestContext: one token per client, `token-<label>` in MCP_HTTP_TOKENS_DIR). Never from an
 * argument: the session id a caller sends is its own claim, the label is what the deployment issued it.
 *
 *   guest-<id>     the guest <id>: tenant `guest:<id>`
 *   anything else  (any other label, a local stdio run): the deployment's own agents, tenant `default`
 *
 * A label that starts with `guest` and is not a well-formed guest gets a tenant no catalog can name
 * (domain/catalog.ts TENANT), so it owns nothing and sees nothing: a typo never lands in the default tenant.
 */
import { DEFAULT_TENANT, GUEST_ID, type Tenant } from "./catalog.js";

export const tenantOfClient = (client: string): Tenant => {
  if (!client.startsWith("guest")) return DEFAULT_TENANT;
  const id = client.startsWith("guest-") ? client.slice("guest-".length) : "";
  return GUEST_ID.test(id) ? `guest:${id}` : `guest:!${client}`;
};
