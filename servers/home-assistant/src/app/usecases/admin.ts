import { ADMIN_TOOLS } from "../../domain/admin.js";
import { fail } from "../../domain/errors.js";
import type { Deps } from "../ports.js";

/**
 * Refuse here, without a request, what only an administrator may do when the
 * token's user is not one: Home Assistant would answer 401 and count it as a
 * failed login. Learning who the token is costs one WebSocket session per
 * token; after that it is known.
 */
export const requireAdmin = async (deps: Deps, what: string, why: string): Promise<void> => {
  const user = await deps.ha.user();
  if (user.isAdmin) return;
  fail({
    kind: "needs_admin",
    what,
    sent: false,
    message: `${what} needs an administrator's token: ${why}, and this token's user${user.name === undefined ? "" : ` (${user.name})`} is not one; nothing was sent`,
  });
};

export const requireAdminFor = (deps: Deps, tool: keyof typeof ADMIN_TOOLS & string): Promise<void> =>
  requireAdmin(deps, tool, ADMIN_TOOLS[tool] ?? "Home Assistant allows it only for administrators");
