import { atPath, connectUpstream, fillTemplate, type UpstreamConnect, type UpstreamEndpoint, type UpstreamTransportFor, usingUpstream } from "@foreverworks/mcp-kit";

import type { CodeInfo, CodeSource, CredentialSource, Credentials } from "../app/ports.js";
import { configError, fail, upstreamError } from "../domain/errors.js";
import type { AppConfig } from "./config.js";
import { totpAt, totpKeyOf } from "./signIn/totp.js";

/**
 * Where the e-mail, the password and the authenticator code come from, read
 * at each password sign-in and never kept by this server (anaf-spv and eToll
 * read their logins the same way):
 *
 * - a vault MCP server: one tool call (by default `get_password` with
 *   `{"id": "<item>"}`, which is this repository's bitwarden server) whose
 *   JSON answer carries the password and usually the user name, and a second
 *   one (by default `totp`, same arguments) for the code. Any other vault
 *   server is the same settings: the tools, their arguments, the fields;
 * - files (ESANATATEAMEA_PASSWORD_FILE, ESANATATEAMEA_TOTP_SECRET_FILE), or
 *   variables for a local run, with ESANATATEAMEA_USERNAME.
 *
 * A code read when its window is about to close would die in flight, so with
 * less than CODE_MARGIN_S left the source waits for the next one.
 */
export const CODE_MARGIN_S = 5;

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined);

const asArgs = (filled: unknown, name: string): Readonly<Record<string, unknown>> =>
  typeof filled === "object" && filled !== null && !Array.isArray(filled) ? (filled as Readonly<Record<string, unknown>>) : fail(configError(`${name} must be a JSON object`));

/** The vault as the kit's MCP client reaches it; its failures are this server's `upstream`. */
export const vaultConnect = (endpoint: UpstreamEndpoint, transportFor?: UpstreamTransportFor): UpstreamConnect =>
  connectUpstream(endpoint, {
    name: "vault",
    client: { name: "mcp-esanatateamea", version: "1.0.0" },
    fail: (message) => fail(upstreamError("vault", message)),
    ...(transportFor === undefined ? {} : { transportFor }),
  });

type Sources = { readonly now: () => number; readonly sleep: (ms: number) => Promise<void> };

export const makeCredentialSource = (
  config: AppConfig,
  { now, sleep }: Sources,
  connectFor: (endpoint: UpstreamEndpoint) => UpstreamConnect = vaultConnect,
): CredentialSource => {
  const { vault } = config;
  if (vault.upstream.kind === "invalid") {
    const message = vault.upstream.message;
    return { info: { kind: "invalid", message }, configured: true, code: undefined, read: async () => fail(configError(message)) };
  }
  if (vault.upstream.kind === "endpoint") {
    const connect = connectFor(vault.upstream.endpoint);
    const item = vault.item;
    const args = (): Readonly<Record<string, unknown>> => {
      const id = item ?? fail(configError("ESANATATEAMEA_VAULT_ITEM is not set: which vault item holds the eSănătateaMea login"));
      if (!vault.args.ok) return fail(configError(vault.args.message));
      return asArgs(fillTemplate(vault.args.value, { item: id }), "ESANATATEAMEA_VAULT_ARGS");
    };
    const codeTool = vault.codeTool;
    const askCode = async (): Promise<{ readonly code: string; readonly secondsLeft: number | undefined }> => {
      const answer = await usingUpstream(connect, (c) => c.call(codeTool ?? "", args()));
      const body = answer.json ?? answer.text;
      const code = text(atPath(body, vault.codeField)) ?? (typeof body === "string" ? text(body) : undefined);
      if (code === undefined) return fail(upstreamError("vault", `${codeTool ?? ""}'s answer has no "${vault.codeField}" (ESANATATEAMEA_VAULT_CODE_FIELD)`));
      const left = atPath(body, "secondsLeft");
      return { code, secondsLeft: typeof left === "number" ? left : undefined };
    };
    const code: CodeSource | undefined =
      codeTool === undefined
        ? undefined
        : {
            info: { kind: "mcp", tool: codeTool },
            read: async () => {
              const first = await askCode();
              if (first.secondsLeft === undefined || first.secondsLeft >= CODE_MARGIN_S) return first.code;
              await sleep((first.secondsLeft + 1) * 1000);
              return (await askCode()).code;
            },
          };
    return {
      info: { kind: "mcp", transport: vault.upstream.transport, tool: vault.tool, item: item ?? "(none)" },
      configured: true,
      code,
      read: async (): Promise<Credentials> => {
        const answer = await usingUpstream(connect, (c) => c.call(vault.tool, args()));
        const body = answer.json ?? (vault.passwordField === "." ? answer.text : undefined);
        if (body === undefined) fail(upstreamError("vault", `${vault.tool} did not answer JSON; set ESANATATEAMEA_VAULT_PASSWORD_FIELD to "." if its whole answer is the password`));
        const password = text(atPath(body, vault.passwordField)) ?? fail(upstreamError("vault", `${vault.tool}'s answer has no "${vault.passwordField}" (ESANATATEAMEA_VAULT_PASSWORD_FIELD)`));
        const username =
          config.username ??
          text(atPath(body, vault.usernameField)) ??
          fail(upstreamError("vault", `${vault.tool}'s answer has no "${vault.usernameField}" (ESANATATEAMEA_VAULT_USERNAME_FIELD); or set ESANATATEAMEA_USERNAME`));
        return { username, password };
      },
    };
  }
  const secret = config.totpSecret;
  const code: CodeSource | undefined =
    secret === undefined || config.totpFrom === undefined
      ? undefined
      : {
          info: { kind: config.totpFrom } satisfies CodeInfo,
          read: async () => {
            const key = totpKeyOf(await secret()) ?? fail(configError("the authenticator secret is not a base32 key or an otpauth:// address"));
            const first = totpAt(key, now());
            if (first.secondsLeft >= CODE_MARGIN_S) return first.code;
            await sleep((first.secondsLeft + 1) * 1000);
            return totpAt(key, now()).code;
          },
        };
  const password = config.password;
  if (password !== undefined && config.passwordFrom !== undefined) {
    return {
      info: { kind: config.passwordFrom, username: config.username },
      configured: true,
      code,
      read: async (): Promise<Credentials> => {
        const username = config.username ?? fail(configError("ESANATATEAMEA_USERNAME is not set; the password alone cannot sign in"));
        return { username, password: await password() };
      },
    };
  }
  return {
    info: { kind: "none" },
    configured: false,
    code,
    read: async () =>
      fail(configError("no eSănătateaMea password is configured (ESANATATEAMEA_USERNAME with ESANATATEAMEA_PASSWORD_FILE, or ESANATATEAMEA_VAULT_MCP_URL); sign in with ROeID instead")),
  };
};
