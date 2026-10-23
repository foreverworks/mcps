import type { CredentialInfo, CredentialSource, Credentials } from "../app/ports.js";
import { configError, fail, upstreamError } from "../domain/errors.js";
import { atPath, type Connect, fillTemplate, succeeded, using } from "./upstream/mcp.js";

/**
 * Where the SPV user name and password come from, read at each sign-in and
 * never kept by this server:
 *
 * - a vault MCP server: one tool call (by default `get_password` with
 *   `{"id": "<item>"}`, which is this repository's bitwarden server) whose JSON
 *   answer carries the password and usually the user name. Any other vault
 *   server is the same three settings: the tool, its arguments, the fields.
 *   The vault stays the one place the password lives, so changing it there is
 *   all a rotation takes;
 * - a file (`ANAF_SPV_PASSWORD_FILE`), or a variable for a local run, with
 *   `ANAF_SPV_USERNAME`.
 */
export type VaultConfig =
  | { readonly kind: "none"; readonly missing: string }
  | { readonly kind: "static"; readonly from: "file" | "variable"; readonly username: string | undefined; readonly password: () => Promise<string | undefined> }
  | {
      readonly kind: "mcp";
      readonly connect: Connect;
      readonly transport: "http" | "stdio";
      readonly tool: string;
      readonly argsTemplate: unknown;
      readonly item: string | undefined;
      readonly passwordField: string;
      readonly usernameField: string;
      readonly username: string | undefined;
    };

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim().length > 0 ? value : undefined);

export const makeCredentialSource = (config: VaultConfig): CredentialSource => {
  switch (config.kind) {
    case "none":
      return { info: { kind: "none", missing: config.missing }, read: async () => fail(configError(`no SPV credential is configured: ${config.missing}`)) };
    case "static": {
      const info: CredentialInfo = { kind: config.from, username: config.username };
      return {
        info,
        read: async (): Promise<Credentials> => {
          const username = config.username ?? fail(configError("ANAF_SPV_USERNAME is not set; the password alone cannot sign in"));
          const password = (await config.password()) ?? fail(configError("the SPV password is empty"));
          return { username, password };
        },
      };
    }
    case "mcp": {
      const item = config.item;
      const info: CredentialInfo = { kind: "mcp", transport: config.transport, tool: config.tool, item: item ?? "(none)" };
      return {
        info,
        read: async (): Promise<Credentials> => {
          if (item === undefined) return fail(configError("ANAF_SPV_VAULT_ITEM is not set: which vault item holds the SPV login"));
          const answer = await using(config.connect, async (c) => succeeded("vault", config.tool, await c.call(config.tool, asArgs(fillTemplate(config.argsTemplate, { item })))));
          const body = answer.json ?? (config.passwordField === "." ? answer.text : undefined);
          if (body === undefined) fail(upstreamError("vault", `${config.tool} did not answer JSON; set ANAF_SPV_VAULT_PASSWORD_FIELD to "." if its whole answer is the password`));
          const password = text(atPath(body, config.passwordField)) ?? fail(upstreamError("vault", `${config.tool}'s answer has no "${config.passwordField}" (ANAF_SPV_VAULT_PASSWORD_FIELD)`));
          const username =
            config.username ??
            text(atPath(body, config.usernameField)) ??
            fail(upstreamError("vault", `${config.tool}'s answer has no "${config.usernameField}" (ANAF_SPV_VAULT_USERNAME_FIELD); or set ANAF_SPV_USERNAME`));
          return { username, password };
        },
      };
    }
  }
};

const asArgs = (filled: unknown): Readonly<Record<string, unknown>> =>
  typeof filled === "object" && filled !== null && !Array.isArray(filled) ? (filled as Readonly<Record<string, unknown>>) : fail(configError("ANAF_SPV_VAULT_ARGS must be a JSON object"));
