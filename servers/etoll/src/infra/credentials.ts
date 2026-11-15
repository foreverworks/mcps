import { atPath, connectUpstream, fillTemplate, type UpstreamConnect, type UpstreamEndpoint, type UpstreamTransportFor, usingUpstream } from "@foreverworks/mcp-kit";

import type { CredentialInfo, CredentialSource, Credentials } from "../app/ports.js";
import { configError, fail, upstreamError } from "../domain/errors.js";
import type { AppConfig } from "./config.js";

/**
 * Where the eToll user name and password come from, read at each password
 * sign-in and never kept by this server (anaf-spv reads its SPV login the
 * same way):
 *
 * - a vault MCP server: one tool call (by default `get_password` with
 *   `{"id": "<item>"}`, which is this repository's bitwarden server) whose
 *   JSON answer carries the password and usually the user name. Any other
 *   vault server is the same three settings: the tool, its arguments, the
 *   fields. The vault stays the one place the password lives;
 * - a file (ETOLL_PASSWORD_FILE), or a variable for a local run, with
 *   ETOLL_USERNAME.
 *
 * Neither configured: no password sign-in, and a session comes only from the
 * browser (begin_login).
 */

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim().length > 0 ? value : undefined);

const asArgs = (filled: unknown): Readonly<Record<string, unknown>> =>
  typeof filled === "object" && filled !== null && !Array.isArray(filled) ? (filled as Readonly<Record<string, unknown>>) : fail(configError("ETOLL_VAULT_ARGS must be a JSON object"));

/** The vault as the kit's MCP client reaches it; its failures are this server's `upstream`. */
export const vaultConnect = (endpoint: UpstreamEndpoint, transportFor?: UpstreamTransportFor): UpstreamConnect =>
  connectUpstream(endpoint, {
    name: "vault",
    client: { name: "mcp-etoll", version: "1.0.0" },
    fail: (message) => fail(upstreamError("vault", message)),
    ...(transportFor === undefined ? {} : { transportFor }),
  });

export const makeCredentialSource = (config: AppConfig, connectFor: (endpoint: UpstreamEndpoint) => UpstreamConnect = vaultConnect): CredentialSource => {
  const { vault } = config;
  if (vault.upstream.kind === "invalid") {
    const message = vault.upstream.message;
    return { info: { kind: "invalid", message }, configured: true, read: async () => fail(configError(message)) };
  }
  if (vault.upstream.kind === "endpoint") {
    const connect = connectFor(vault.upstream.endpoint);
    const info: CredentialInfo = { kind: "mcp", transport: vault.upstream.transport, tool: vault.tool, item: vault.item ?? "(none)" };
    return {
      info,
      configured: true,
      read: async (): Promise<Credentials> => {
        const item = vault.item ?? fail(configError("ETOLL_VAULT_ITEM is not set: which vault item holds the eToll login"));
        if (!vault.args.ok) return fail(configError(vault.args.message));
        const template = vault.args.value;
        const answer = await usingUpstream(connect, (c) => c.call(vault.tool, asArgs(fillTemplate(template, { item }))));
        const body = answer.json ?? (vault.passwordField === "." ? answer.text : undefined);
        if (body === undefined) fail(upstreamError("vault", `${vault.tool} did not answer JSON; set ETOLL_VAULT_PASSWORD_FIELD to "." if its whole answer is the password`));
        const password = text(atPath(body, vault.passwordField)) ?? fail(upstreamError("vault", `${vault.tool}'s answer has no "${vault.passwordField}" (ETOLL_VAULT_PASSWORD_FIELD)`));
        const username =
          config.username ??
          text(atPath(body, vault.usernameField)) ??
          fail(upstreamError("vault", `${vault.tool}'s answer has no "${vault.usernameField}" (ETOLL_VAULT_USERNAME_FIELD); or set ETOLL_USERNAME`));
        return { username, password };
      },
    };
  }
  const password = config.password;
  if (password !== undefined && config.passwordFrom !== undefined) {
    return {
      info: { kind: config.passwordFrom, username: config.username },
      configured: true,
      read: async (): Promise<Credentials> => {
        const username = config.username ?? fail(configError("ETOLL_USERNAME is not set; the password alone cannot sign in"));
        return { username, password: await password() };
      },
    };
  }
  return {
    info: { kind: "none" },
    configured: false,
    read: async () => fail(configError("no eToll password is configured (ETOLL_USERNAME with ETOLL_PASSWORD_FILE, or ETOLL_VAULT_MCP_URL); sign in with begin_login instead")),
  };
};
