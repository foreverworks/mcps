import type { ToolPolicy } from "@foreverworks/mcp-kit";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts).
 *
 * `get_password`, `get_field` and `totp` hand a secret to the calling agent, and are still
 * `read`, not `money` as Porkbun's private keys are: this server is meant for
 * an account that holds the agent's OWN logins, made for it to use without
 * asking. A person's own passwords belong in a vault this account cannot
 * reach; what a person lends goes into a shared collection on purpose.
 * `create_note` is a plain write, not idempotent: a second call makes a second
 * note. `move_item` sets an item's collection, so it is idempotent: a second
 * call finds the item there and sends nothing.
 *
 * Passkeys follow the same line. `assert_passkey` is `read`: it hands out a
 * signature made with one of the account's passkeys, as `get_password` hands
 * out a password, and the only thing it ever writes is the passkey's counter
 * when that is already above 0 (Bitwarden's apps make every passkey with 0,
 * and leave a 0 alone). `create_passkey` and `import_passkeys` add to the
 * vault; `create_passkey` replaces a login's passkey only when it is for the
 * same account on the same site, as Bitwarden's apps do. `delete_passkey` is
 * the one tool that removes anything, one passkey from its login, and says so
 * with `destructiveHint`. Nothing exports or touches the account's settings.
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
  move_item: { access: "write", idempotent: true },
  list_passkeys: { access: "read" },
  assert_passkey: { access: "read" },
  create_passkey: { access: "write" },
  import_passkeys: { access: "write" },
  delete_passkey: { access: "write" },
};
