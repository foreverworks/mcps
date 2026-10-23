import type { ToolPolicy } from "@foreverworks/mcp-kit";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts).
 *
 * `get_password`, `get_field` and `totp` hand a secret to the calling agent, and are still
 * `read`, not `money` as Porkbun's private keys are: this server is meant for
 * an account that holds the agent's OWN logins, made for it to use without
 * asking. A person's own passwords belong in a vault this account cannot
 * reach; what a person lends goes into a shared collection on purpose. Nothing
 * here deletes, exports, or touches the account's settings. `create_note` is a
 * plain write, not idempotent: a second call makes a second note.
 */
export const POLICY: ToolPolicy = {
  health: { access: "read" },
  find_logins: { access: "read" },
  get_login: { access: "read" },
  get_password: { access: "read" },
  get_field: { access: "read" },
  totp: { access: "read" },
  check_exposed: { access: "read" },
  sync: { access: "read" },
  create_login: { access: "write" },
  update_login: { access: "write" },
  create_note: { access: "write" },
};
