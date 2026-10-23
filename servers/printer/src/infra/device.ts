import type { TLSSocket } from "node:tls";

import { hostAllowed } from "@foreverworks/mcp-kit";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";

import { type AppError, fail } from "../domain/errors.js";

/**
 * HTTP to one device on a local network, which almost never has a
 * certificate any authority signed: printers make their own. So a TLS
 * connection is accepted when the certificate is the one pinned
 * (PRINTER_TLS_SHA256), checked after the handshake and before a single
 * request byte is written; with nothing pinned, only a certificate that
 * verifies normally (chain and name) is accepted, and a refusal names the
 * fingerprint the device showed, so an operator can compare it with the
 * device's own page and pin it.
 *
 * Requests go through undici's own fetch (the version its Agent belongs to,
 * not the one built into Node), and the kit's egress allowlist
 * (MCP_EGRESS_ALLOW) is applied here as it is to every other server's fetch.
 */

export type DeviceResponse = { readonly status: number; readonly headers: Headers; readonly body: Uint8Array };

export type DeviceRequest = {
  readonly method?: "GET" | "POST" | "DELETE";
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: Blob | Uint8Array | string;
  readonly timeoutMs: number;
};

export type DeviceHttp = (url: URL, request: DeviceRequest) => Promise<DeviceResponse>;

/** The part of fetch this uses, so a test can stand in for the device. */
export type DeviceFetch = (
  url: URL,
  init: { readonly method: string; readonly headers: Readonly<Record<string, string>>; readonly body?: Blob | Uint8Array | string; readonly signal: AbortSignal; readonly dispatcher: Agent },
) => Promise<{ readonly status: number; readonly headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer> }>;

/** Hex, lower case, no separators: how a fingerprint is compared. */
export const normaliseFingerprint = (text: string): string => text.replace(/[^0-9a-fA-F]/g, "").toLowerCase();

const PIN_MISMATCH = "PRINTER_TLS_PIN";

type PinFailure = Error & { readonly code: typeof PIN_MISMATCH; readonly sha256: string; readonly detail: string };

const pinFailure = (sha256: string, detail: string): PinFailure => Object.assign(new Error(detail), { code: PIN_MISMATCH, sha256, detail }) as PinFailure;

/**
 * A connector that hands undici a TLS socket only once its certificate passed.
 * No TLS session is cached: a resumed session shows no certificate, which
 * the pin would then refuse (printers do resume sessions on a second
 * connection), and a pin checked once per session would trust
 * every later connection on the strength of the first. A full handshake per
 * connection is cheap next to a page of raster, and keep-alive spares most.
 */
const pinnedConnector = (pin: string | undefined, connectTimeoutMs: number): buildConnector.connector => {
  const base = buildConnector({ rejectUnauthorized: false, timeout: connectTimeoutMs, maxCachedSessions: 0 });
  return (options, callback) =>
    base(options, (error, socket) => {
      if (error !== null) return callback(error, null);
      if (options.protocol !== "https:") return callback(null, socket);
      const tls = socket as TLSSocket;
      const shown = normaliseFingerprint(tls.getPeerCertificate().fingerprint256 ?? "");
      if (shown === "") {
        tls.destroy();
        return callback(pinFailure("", "the device showed no certificate on this connection"), null);
      }
      if (pin !== undefined) {
        if (shown === pin) return callback(null, socket);
        tls.destroy();
        return callback(pinFailure(shown, `the device's certificate is not the one pinned (it shows ${shown})`), null);
      }
      if (tls.authorized) return callback(null, socket);
      tls.destroy();
      return callback(pinFailure(shown, `the device's certificate does not verify (${String(tls.authorizationError)}) and none is pinned`), null);
    });
};

const causeChain = (thrown: unknown): readonly unknown[] => {
  const chain: unknown[] = [];
  let at: unknown = thrown;
  while (at !== undefined && at !== null && chain.length < 6) {
    chain.push(at);
    at = (at as { cause?: unknown }).cause;
  }
  return chain;
};

/** A failed fetch, in this server's words: which device, and why. */
export const transportFailure = (thrown: unknown, device: "printer" | "scanner", url: URL, timeoutMs: number): AppError => {
  const chain = causeChain(thrown);
  const pin = chain.find((c): c is PinFailure => (c as { code?: unknown }).code === PIN_MISMATCH);
  if (pin !== undefined) return { kind: "tls", sha256: pin.sha256, message: pin.detail };
  if (chain.some((c) => (c as { name?: unknown }).name === "TimeoutError")) {
    return { kind: "unreachable", device, message: `the ${device} at ${url.host} did not answer within ${Math.round(timeoutMs / 1000)} s` };
  }
  const code = chain.map((c) => (c as { code?: unknown }).code).find((c): c is string => typeof c === "string");
  return { kind: "unreachable", device, message: `could not reach the ${device} at ${url.host}${code === undefined ? "" : ` (${code})`}` };
};

export const makeDeviceHttp = (options: {
  readonly pin?: string | undefined;
  readonly device: "printer" | "scanner";
  /** MCP_EGRESS_ALLOW's hosts; undefined, no limit. */
  readonly egress?: readonly string[] | undefined;
  readonly fetch?: DeviceFetch;
  readonly connectTimeoutMs?: number;
}): DeviceHttp => {
  const dispatcher = new Agent({ connect: pinnedConnector(options.pin, options.connectTimeoutMs ?? 10_000), allowH2: false, keepAliveTimeout: 4_000 });
  const doFetch: DeviceFetch = options.fetch ?? ((url, init) => undiciFetch(url, init as Parameters<typeof undiciFetch>[1]));
  return async (url, request) => {
    if (options.egress !== undefined && !hostAllowed(url.hostname.replace(/^\[|\]$/g, ""), options.egress)) {
      return fail({ kind: "config", variable: "MCP_EGRESS_ALLOW", message: `egress to ${url.hostname} is not allowed for this server (MCP_EGRESS_ALLOW)` });
    }
    try {
      const response = await doFetch(url, {
        method: request.method ?? "GET",
        headers: request.headers ?? {},
        ...(request.body === undefined ? {} : { body: request.body }),
        signal: AbortSignal.timeout(request.timeoutMs),
        dispatcher,
      });
      const headers = new Headers();
      for (const name of ["content-type", "location", "content-length"]) {
        const value = response.headers.get(name);
        if (value !== null) headers.set(name, value);
      }
      return { status: response.status, headers, body: new Uint8Array(await response.arrayBuffer()) };
    } catch (thrown) {
      return fail(transportFailure(thrown, options.device, url, request.timeoutMs));
    }
  };
};
