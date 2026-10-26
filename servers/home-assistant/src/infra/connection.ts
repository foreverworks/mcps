import { createHash } from "node:crypto";

import { egressFrom, hostAllowed, readSecret } from "@foreverworks/mcp-kit";

import { type AppError, asAppError, fail, URL_VARIABLE } from "../domain/errors.js";

/**
 * Where Home Assistant is and the token it takes, read again on every call,
 * and the rule that keeps this server from getting its own address banned.
 *
 * Home Assistant logs every request with a refused token as a failed login,
 * raises a "Login attempt failed" notification, and where IP banning is on,
 * bans the address after as few failed logins as its settings say, for good
 * (ip_bans.yaml). So a token it refused is never sent again: the refusal is
 * remembered by the token's SHA-256, and every later call fails at once,
 * without a request, until the token file holds another token or the
 * process restarts. And until a token has been accepted once, requests go
 * one at a time, so a wrong token costs one failed login, not one per
 * request a tool had in flight.
 */

/** HOME_ASSISTANT_URL as a base every API path resolves against (always ending in /), or a config failure. Pure. */
export const baseUrlOf = (raw: string | undefined): URL => {
  const text = raw?.trim() ?? "";
  const bad = (why: string): never => fail({ kind: "config", variable: URL_VARIABLE, message: `${URL_VARIABLE} ${why}` });
  if (text === "") bad("is not set: the address Home Assistant opens at, such as http://homeassistant.local:8123");
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return bad(`is not an address: "${text}"`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") bad("must start with http:// or https://");
  if (url.username !== "" || url.password !== "") bad("must not carry a user name or password: the token goes in its own file");
  if (url.search !== "" || url.hash !== "") bad("must not carry a query or a fragment");
  const path = url.pathname.replace(/\/+$/, "");
  if (/\/api$/.test(path)) bad("ends in /api: give the address Home Assistant opens at, without /api");
  url.pathname = `${path}/`;
  return url;
};

/** The host the process must reach, as MCP_EGRESS_ALLOW names it (an IPv6 address without brackets). Pure. */
export const egressHostOf = (base: URL): string => base.hostname.replace(/^\[|\]$/g, "");

/** An API path under the base, so an instance served under a path prefix works too. Pure. */
export const apiUrl = (base: URL, path: string): URL => new URL(path.replace(/^\/+/, ""), base);

/** The WebSocket API's address: ws:// for http://, wss:// for https://. Pure. */
export const socketUrlOf = (base: URL): URL => {
  const url = apiUrl(base, "api/websocket");
  url.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  return url;
};

export type Connection = {
  /** The base URL, or a config failure: unset, unusable, or a host MCP_EGRESS_ALLOW does not allow. */
  readonly base: () => URL;
  /**
   * Run `send` with the token: never with one Home Assistant refused, and
   * one at a time until it accepted this one. A refusal `send` reports (an
   * `auth` failure) is remembered.
   */
  readonly withToken: <T>(send: (token: string) => Promise<T>) => Promise<T>;
};

/** Failures that prove Home Assistant accepted the token: it got as far as answering the request itself. */
const PROVES: ReadonlySet<AppError["kind"]> = new Set(["not_found", "rejected", "permission"]);

export const makeConnection = (env: NodeJS.ProcessEnv, now: () => number): Connection => {
  let refused: { readonly digest: string; readonly status: 401 | 403; readonly at: string } | undefined;
  let proven: string | undefined;
  let gate: Promise<unknown> = Promise.resolve();

  const base = (): URL => {
    const url = baseUrlOf(env["HOME_ASSISTANT_URL"]);
    const egress = egressFrom(env);
    const host = egressHostOf(url);
    if (egress !== undefined && !hostAllowed(host, egress)) {
      fail({ kind: "config", variable: "MCP_EGRESS_ALLOW", message: `egress to ${host}, the host of ${URL_VARIABLE}, is not allowed for this server (MCP_EGRESS_ALLOW)` });
    }
    return url;
  };

  const readToken = async (): Promise<{ readonly token: string; readonly digest: string }> => {
    const variable = "HOME_ASSISTANT_TOKEN_FILE";
    const configFail = (message: string): never => fail({ kind: "config", variable, message });
    const token =
      (await readSecret(env, { file: "HOME_ASSISTANT_TOKEN_FILE", value: "HOME_ASSISTANT_TOKEN" }, configFail)) ??
      configFail(`${variable} is not set: the file holding a long-lived access token`);
    return { token, digest: createHash("sha256").update(token).digest("hex") };
  };

  const unlessRefused = (digest: string): void => {
    if (refused?.digest !== digest) return;
    fail({
      kind: "auth",
      status: refused.status,
      sent: false,
      message: `not sent: Home Assistant refused this token at ${refused.at} (${refused.status === 401 ? "401, the token" : "403, this address"})`,
    });
  };

  const attempt = async <T>(send: (token: string) => Promise<T>, token: string, digest: string): Promise<T> => {
    unlessRefused(digest);
    try {
      const value = await send(token);
      proven = digest;
      return value;
    } catch (thrown) {
      const known = asAppError(thrown);
      if (known?.kind === "auth") {
        refused = { digest, status: known.status, at: new Date(now()).toISOString() };
        if (proven === digest) proven = undefined;
      } else if (known !== undefined && PROVES.has(known.kind)) {
        proven = digest;
      }
      throw thrown;
    }
  };

  const withToken = async <T>(send: (token: string) => Promise<T>): Promise<T> => {
    const { token, digest } = await readToken();
    unlessRefused(digest);
    if (proven === digest) return attempt(send, token, digest);
    const run = gate.then(() => attempt(send, token, digest));
    gate = run.catch(() => undefined);
    return run;
  };

  return { base, withToken };
};
