import { callSignal, unlessCancelled } from "@foreverworks/mcp-kit";

import { type AppError, drift, fail } from "../domain/errors.js";
import type { WireSocketMessage } from "../domain/schema.js";
import { type Connection, egressHostOf, socketUrlOf } from "./connection.js";

/**
 * Home Assistant's WebSocket API, for what only it serves (the area, floor,
 * device and entity registries): one short session per call. Open, wait for
 * auth_required, send the token, and on auth_ok send every command at once,
 * each with its own id; close when every result is in. auth_invalid is a
 * refused token like a REST 401, and counts as a failed login the same way.
 *
 * The kit's egress allowlist covers fetch, not a WebSocket, so the host is
 * checked here before a connection is made (Connection.base).
 */

/** The part of a WHATWG WebSocket this uses, so a test can stand in for Home Assistant. */
export type SocketLike = {
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { readonly code?: number; readonly reason?: string }) => void) | null;
  send: (data: string) => void;
  close: () => void;
};

export type OpenSocket = (url: string) => SocketLike;

/** Node's own WebSocket (undici's, global since Node 22). */
export const openNodeSocket: OpenSocket = (url) => new (globalThis as unknown as { readonly WebSocket: new (url: string) => SocketLike }).WebSocket(url);

export type SocketCommand = Readonly<Record<string, unknown>> & { readonly type: string };

export type SocketResult = { readonly ok: true; readonly result: unknown } | { readonly ok: false; readonly code: string; readonly message: string };

/** `digest`: the SHA-256 of the token the session signed in with, which what it learned is kept by. */
export type Session = { readonly version: string; readonly digest: string; readonly results: readonly SocketResult[] };

export type Socket = { readonly run: (commands: readonly SocketCommand[]) => Promise<Session> };

export const SESSION_TIMEOUT_MS = 30_000;

const messagesOf = (data: unknown): readonly WireSocketMessage[] => {
  if (typeof data !== "string") return fail(drift("the WebSocket API sent a frame that is not text"));
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return fail(drift(`the WebSocket API sent something that is not JSON: ${data.slice(0, 120)}`));
  }
  // Coalesced messages arrive as an array, when a client asks for that.
  return (Array.isArray(parsed) ? parsed : [parsed]) as readonly WireSocketMessage[];
};

const session = (open: OpenSocket, url: URL, host: string, token: string, digest: string, commands: readonly SocketCommand[], timeoutMs: number): Promise<Session> =>
  new Promise<Session>((resolve, reject) => {
    let done = false;
    let version: string | undefined;
    const results = new Map<number, SocketResult>();
    let socket: SocketLike | undefined;
    const signal = callSignal();

    const finish = (outcome: { readonly session: Session } | { readonly thrown: unknown }): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (socket !== undefined) {
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        try {
          socket.close();
        } catch {
          // Already closed: nothing to release.
        }
      }
      if ("session" in outcome) resolve(outcome.session);
      else reject(outcome.thrown);
    };
    const failWith = (error: AppError): void => {
      try {
        fail(error);
      } catch (thrown) {
        finish({ thrown });
      }
    };
    const onAbort = (): void => {
      try {
        unlessCancelled("the WebSocket session was abandoned");
      } catch (thrown) {
        finish({ thrown });
      }
    };
    const timer = setTimeout(
      () => failWith({ kind: "unreachable", message: `Home Assistant's WebSocket API at ${host} did not answer within ${Math.round(timeoutMs / 1000)} s` }),
      timeoutMs,
    );
    signal?.addEventListener("abort", onAbort);
    if (signal?.aborted === true) return onAbort();

    const send = (message: Readonly<Record<string, unknown>>): void => socket?.send(JSON.stringify(message));

    const onMessage = (message: WireSocketMessage): void => {
      switch (message.type) {
        case "auth_required":
          send({ type: "auth", access_token: token });
          return;
        case "auth_ok":
          version = message.ha_version ?? "";
          if (commands.length === 0) return finish({ session: { version, digest, results: [] } });
          commands.forEach((command, i) => send({ ...command, id: i + 1 }));
          return;
        case "auth_invalid":
          return failWith({ kind: "auth", status: 401, sent: true, message: `Home Assistant refused the token on its WebSocket API${message.message === undefined ? "" : `: ${message.message}`}` });
        case "result": {
          const id = message.id;
          if (id === undefined || id < 1 || id > commands.length) return;
          results.set(
            id,
            message.success === true
              ? { ok: true, result: message.result }
              : { ok: false, code: message.error?.code ?? "unknown_error", message: message.error?.message ?? "no message" },
          );
          if (results.size === commands.length && version !== undefined) {
            finish({ session: { version, digest, results: commands.map((_, i) => results.get(i + 1) as SocketResult) } });
          }
          return;
        }
        default:
          return;
      }
    };

    try {
      socket = open(url.toString());
    } catch (thrown) {
      return failWith({ kind: "unreachable", message: `could not open Home Assistant's WebSocket API at ${host}: ${thrown instanceof Error ? thrown.message : String(thrown)}` });
    }
    socket.onmessage = (event) => {
      try {
        for (const message of messagesOf(event.data)) {
          if (done) return;
          onMessage(message);
        }
      } catch (thrown) {
        finish({ thrown });
      }
    };
    socket.onerror = () => failWith({ kind: "unreachable", message: `could not reach Home Assistant's WebSocket API at ${host}` });
    socket.onclose = (event) =>
      failWith({ kind: "unreachable", message: `Home Assistant's WebSocket API at ${host} closed the connection${event.code === undefined ? "" : ` (${event.code}${event.reason ? `, ${event.reason}` : ""})`}` });
  });

export const makeSocket = (conn: Connection, open: OpenSocket, timeoutMs = SESSION_TIMEOUT_MS): Socket => ({
  run: async (commands) => {
    const base = conn.base();
    return conn.withToken((token, digest) => session(open, socketUrlOf(base), egressHostOf(base), token, digest, commands, timeoutMs));
  },
});

/** A command's failure, in this server's words. `what` names the command for the message. */
export const socketFailure = (what: string, failed: Extract<SocketResult, { ok: false }>): AppError => {
  switch (failed.code) {
    case "unauthorized":
      return { kind: "permission", message: `Home Assistant answers ${what} only for administrators: ${failed.message}` };
    case "unknown_command":
      return { kind: "not_found", what: "endpoint", name: what, message: `Home Assistant does not know ${what}: it is older than this server expects, or the integration is not loaded` };
    default:
      return { kind: "rejected", status: 400, message: `Home Assistant refused ${what}: ${failed.code}: ${failed.message}` };
  }
};

