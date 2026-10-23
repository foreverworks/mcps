import type { Access } from "../policy.js";

/**
 * What the guard does before a tool runs, beyond the policy itself.
 *
 * The standard MCP arrangement is that the CLIENT asks its user before a tool
 * with consequences runs: every tool here carries `readOnlyHint` and
 * `destructiveHint` derived from its access class, and a client (Claude Code,
 * Codex, VS Code, Cursor) prompts on them or on its own permission rules. Two
 * settings let a deployment shape that:
 *
 * - `MCP_MAX_ACCESS`, a ceiling: `read` runs read tools only, `write` adds
 *   writes, `money` (the default) everything. A tool above the ceiling is still
 *   listed, says it is disabled and why, and refuses every call.
 * - `MCP_CLIENT_MAX_ACCESS`, a lower ceiling for named clients
 *   (`peer=read,other=write`): the client a bearer token belongs to may run
 *   tools up to its class and no higher. For a service that calls this one as
 *   its client and needs to read, not send or pay. Tools are listed the same to
 *   every client; a call above the client's ceiling is refused.
 * - `MCP_CONFIRM`, who confirms a `money` call with the user (and a `write`
 *   its policy marks `confirm`, the same way):
 *   - `client` (the default): the client, which the tool tells so. Besides the
 *     hints, a money tool carries `_meta["anthropic/requiresUserInteraction"]`,
 *     which Claude Code honours by prompting on every call whatever its
 *     permission mode or allow rules (and denying where nobody can answer);
 *     other clients prompt on `destructiveHint` or their own per-tool settings.
 *   - `elicit`: the server itself asks, through an MCP elicitation carrying the
 *     one line its policy writes, before the call runs. For a client that runs
 *     tools without asking. The question reaches a client over stdio, and over
 *     HTTP a client of protocol 2026-07-28, where it is the call's own result
 *     and the client calls again with the answer (serve/asking.ts); a
 *     2025-11-25 client over HTTP is refused each such call
 *     (`confirmation_unavailable`), since its stateless transport cannot carry
 *     the question back.
 *   - `none`: the hints only; whether to ask is the client's own policy. For an
 *     unattended deployment whose money calls are decided elsewhere.
 */

export type Confirm = "client" | "elicit" | "none";

export const CONFIRM_MODES: readonly Confirm[] = ["client", "elicit", "none"];

export type GuardSettings = {
  /** The highest access class this server runs. */
  readonly maxAccess: Access;
  readonly confirm: Confirm;
  /** Lower ceilings for named clients (MCP_CLIENT_MAX_ACCESS); a client not named has `maxAccess`. */
  readonly clientMaxAccess?: Readonly<Record<string, Access>>;
};

export const ACCESS_ORDER: readonly Access[] = ["read", "write", "money"];

export const DEFAULT_SETTINGS: GuardSettings = { maxAccess: "money", confirm: "client" };

/** Whether `access` is within `ceiling`. */
export const within = (access: Access, ceiling: Access): boolean => ACCESS_ORDER.indexOf(access) <= ACCESS_ORDER.indexOf(ceiling);

/** The settings from the environment; a value that is not one of the options is a process that must not start. */
export const guardSettingsFrom = (env: NodeJS.ProcessEnv): GuardSettings => {
  const max = env["MCP_MAX_ACCESS"]?.trim() || "money";
  if (!(ACCESS_ORDER as readonly string[]).includes(max)) throw new Error(`MCP_MAX_ACCESS "${max}" is not one of ${ACCESS_ORDER.join(", ")}`);
  const confirm = env["MCP_CONFIRM"]?.trim() || "client";
  if (!(CONFIRM_MODES as readonly string[]).includes(confirm)) throw new Error(`MCP_CONFIRM "${confirm}" is not one of ${CONFIRM_MODES.join(", ")}`);
  const clientMaxAccess = clientCeilingsFrom(env["MCP_CLIENT_MAX_ACCESS"]);
  return { maxAccess: max as Access, confirm: confirm as Confirm, ...(clientMaxAccess === undefined ? {} : { clientMaxAccess }) };
};

/** `peer=read,other=write`: each client's ceiling. A pair that does not read so is a process that must not start. */
const clientCeilingsFrom = (raw: string | undefined): Readonly<Record<string, Access>> | undefined => {
  const pairs = (raw ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (pairs.length === 0) return undefined;
  return Object.fromEntries(
    pairs.map((pair) => {
      const [client = "", access = ""] = pair.split("=").map((x) => x.trim());
      if (!/^[A-Za-z0-9._-]+$/.test(client) || !(ACCESS_ORDER as readonly string[]).includes(access)) {
        throw new Error(`MCP_CLIENT_MAX_ACCESS "${pair}" is not <client>=<${ACCESS_ORDER.join("|")}>`);
      }
      return [client, access as Access];
    }),
  );
};

/** The startup line's words for the settings. */
export const describeSettings = ({ maxAccess, confirm, clientMaxAccess }: GuardSettings): string =>
  [
    maxAccess === "money" ? "every tool enabled" : `tools above ${maxAccess} disabled`,
    ...(clientMaxAccess === undefined
      ? []
      : [`clients limited: ${Object.entries(clientMaxAccess)
          .map(([client, access]) => `${client} ${access}`)
          .join(", ")}`]),
    confirm === "elicit"
      ? "money and confirmed calls confirmed with the user by elicitation"
      : confirm === "client"
        ? "money and confirmed calls marked for the client to confirm"
        : "money and confirmed calls left to the client's own policy",
  ].join("; ");
