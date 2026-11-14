import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { StringDecoder } from "node:string_decoder";

import { type Limits, plainReply } from "@foreverworks/mcp-kit";

import { failedCall, inboxPathsIn, messagesOf, toolCallArguments } from "./calls.js";
import { dataOf, eventOf, splitEvents, withData } from "./sse.js";
import { mirrorLinks, type Transfer, uploadFile } from "./transfer.js";
import { type Answer, readAnswer, reasonOf, send, snippetOf, statusWords } from "./upstream.js";

/**
 * One request to the MCP route, carried to the server and back: POST, GET (its
 * event stream) and DELETE, with the relay's token in place of the client's
 * and the MCP headers passed both ways. Before a tool call goes, the inbox
 * files its arguments name are uploaded; before a response or an event that
 * carries a link to an outbox file reaches the client, the file is fetched.
 * What the relay does not need to read it does not touch: a stream stays a
 * stream, an event with no link goes on as it came.
 */
export type Relay = {
  readonly transfer: Transfer;
  readonly limits: Limits;
};

/** The largest answer the relay will hold whole to look for links in. */
const MAX_HELD = 64 * 1024 * 1024;

const REQUEST_HEADERS = new Set(["accept", "content-type", "last-event-id"]);
const ANSWER_HEADERS = new Set(["content-type", "cache-control", "retry-after", "allow"]);

/** The headers of one side worth passing to the other: the MCP ones (all `mcp-*`, so a protocol's new ones go too) and the few that content negotiation and resumption need. */
const passed = (headers: IncomingHttpHeaders, names: ReadonlySet<string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).flatMap(([name, value]) => (value !== undefined && (names.has(name) || name.startsWith("mcp-")) ? [[name, Array.isArray(value) ? value.join(", ") : value]] : [])),
  );

export const requestHeaders = (headers: IncomingHttpHeaders): Record<string, string> => passed(headers, REQUEST_HEADERS);
export const answerHeaders = (headers: IncomingHttpHeaders): Record<string, string> => passed(headers, ANSWER_HEADERS);

const readRaw = (req: IncomingMessage, maxBytes: number): Promise<{ readonly ok: true; readonly body: Buffer } | { readonly ok: false; readonly status: 400 | 413 }> =>
  new Promise((resolve) => {
    if (Number(req.headers["content-length"] ?? "0") > maxBytes) return resolve({ ok: false, status: 413 });
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        resolve({ ok: false, status: 413 });
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve({ ok: true, body: Buffer.concat(chunks, total) }));
    req.on("error", () => resolve({ ok: false, status: 400 }));
    // A client that hangs up mid-body ends neither way; the first answer given is the one that counts.
    req.on("close", () => resolve({ ok: false, status: 400 }));
  });

const parse = (body: Buffer): unknown => {
  try {
    return JSON.parse(body.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
};

/** What to do with a POST: answer it here (every call in it failed to get its files across), or send this on, and add these responses to what comes back. */
type Prepared = { readonly kind: "answer"; readonly body: unknown } | { readonly kind: "send"; readonly body: Buffer; readonly failed: readonly unknown[] };

/**
 * Uploads the inbox files the tool calls in a request name. A call whose file
 * cannot be sent is not made: it is answered with a JSON-RPC error naming the
 * file and why, and the other messages of a batch go on without it.
 */
const prepare = async (relay: Relay, raw: Buffer, signal: AbortSignal): Promise<Prepared> => {
  const { inbox } = relay.transfer;
  const body = inbox === undefined ? undefined : parse(raw);
  if (inbox === undefined || body === undefined) return { kind: "send", body: raw, failed: [] };
  const messages = messagesOf(body);
  const calls = messages.map((message) => {
    const call = toolCallArguments(message);
    return call === undefined ? undefined : { id: call.id, paths: inboxPathsIn(call.arguments, inbox) };
  });
  const paths = [...new Set(calls.flatMap((call) => call?.paths ?? []))];
  if (paths.length === 0) return { kind: "send", body: raw, failed: [] };

  const refused = new Map<string, string>();
  for (const path of paths) {
    const moved = await uploadFile(relay.transfer, path, signal);
    if (!moved.ok) refused.set(path, moved.reason);
  }
  const failed = messages.map((_message, at) => {
    const call = calls[at];
    const path = call?.paths.find((p) => refused.has(p));
    return call === undefined || path === undefined ? undefined : failedCall(call.id, `The relay could not send ${path} to the server, so the call was not made: ${refused.get(path) as string}`);
  });
  const answers = failed.filter((answer) => answer !== undefined);
  if (answers.length === 0) return { kind: "send", body: raw, failed: [] };
  if (answers.length === messages.length) return { kind: "answer", body: Array.isArray(body) ? answers : answers[0] };
  return { kind: "send", body: Buffer.from(JSON.stringify(messages.filter((_message, at) => failed[at] === undefined))), failed: answers };
};

/** A response (or each of a batch's) with the files its links name brought over; the same object when there was nothing to bring. */
const settle = async (relay: Relay, message: unknown, signal: AbortSignal): Promise<unknown> => {
  if (!Array.isArray(message)) return mirrorLinks(relay.transfer, message, signal);
  const settled: unknown[] = [];
  for (const member of message) settled.push(await mirrorLinks(relay.transfer, member, signal));
  return settled.every((member, at) => member === message[at]) ? message : settled;
};

const NEEDS_FETCH = '"resource_link"';

const writeAndWait = (res: ServerResponse, text: string): Promise<void> =>
  res.write(text)
    ? Promise.resolve()
    : new Promise((resolve) => {
        const done = (): void => {
          res.off("drain", done);
          res.off("close", done);
          resolve();
        };
        res.once("drain", done);
        res.once("close", done);
      });

/** An event stream, event by event as it arrives; only an event that carries a link is held while its files are fetched. */
const streamEvents = async (relay: Relay, answer: Answer, res: ServerResponse, failed: readonly unknown[], signal: AbortSignal): Promise<void> => {
  res.writeHead(answer.status, { ...answerHeaders(answer.headers), "content-type": "text/event-stream" });
  res.flushHeaders();
  for (const response of failed) await writeAndWait(res, eventOf(JSON.stringify(response)));
  const rewrite = async (event: string): Promise<string> => {
    const data = relay.transfer.outbox === undefined ? undefined : dataOf(event);
    if (data === undefined || !data.includes(NEEDS_FETCH)) return event;
    const message = parse(Buffer.from(data));
    if (message === undefined) return event;
    const settled = await settle(relay, message, signal);
    return settled === message ? event : withData(event, JSON.stringify(settled));
  };
  const decoder = new StringDecoder("utf8");
  let pending = "";
  try {
    for await (const chunk of answer.body as AsyncIterable<Buffer>) {
      const cut = splitEvents(pending + decoder.write(chunk));
      pending = cut.rest;
      for (const event of cut.events) await writeAndWait(res, await rewrite(event));
    }
    pending += decoder.end();
    if (pending !== "") await writeAndWait(res, pending);
    res.end();
  } catch {
    // The upstream or the client went away mid-stream: what was sent stays sent, and the stream ends where it is.
    res.destroy();
  }
};

/** A whole answer, with the links in it followed when it is JSON that has any. */
const holdAnswer = async (relay: Relay, answer: Answer, res: ServerResponse, failed: readonly unknown[], signal: AbortSignal): Promise<void> => {
  const body = await readAnswer(answer, MAX_HELD);
  if (body === undefined) return plainReply(res, 502, `the upstream's answer is larger than ${MAX_HELD} bytes, which is more than the relay holds`);
  const type = String(answer.headers["content-type"] ?? "");
  const needsLook = type.startsWith("application/json") && (failed.length > 0 || (relay.transfer.outbox !== undefined && body.includes(NEEDS_FETCH)));
  const message = needsLook ? parse(body) : undefined;
  const settled = message === undefined ? undefined : await settle(relay, message, signal);
  const out =
    settled === undefined
      ? body
      : Buffer.from(JSON.stringify(failed.length === 0 ? settled : [...failed, ...(Array.isArray(settled) ? (settled as unknown[]) : [settled])]));
  res.writeHead(answer.status, { ...answerHeaders(answer.headers), "content-length": String(out.length) });
  res.end(out);
};

/** An answer that is not a success, as the status a server would give and a sentence that says it was the upstream. */
const failure = async (relay: Relay, answer: Answer, res: ServerResponse): Promise<void> => {
  const note = await readAnswer(answer, 512);
  const words = statusWords(answer.status, "call");
  const text = note === undefined || note.length === 0 ? "" : snippetOf(note, relay.transfer.upstream);
  // The client's own token was fine, or it would not be here: a refusal of the relay's is a bad gateway, not a 401 that would send it to sign in.
  plainReply(res, answer.status === 401 || answer.status === 403 ? 502 : answer.status, text === "" ? words : `${words}: ${text}`, answerHeaders({ "retry-after": answer.headers["retry-after"], allow: answer.headers["allow"] }));
};

/** Carries one request to the MCP route to the upstream and its answer back. */
export const forwardMcp = async (relay: Relay, req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const { limits, transfer } = relay;
  const method = req.method as "POST" | "GET" | "DELETE";
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) controller.abort();
  });
  const timer = setTimeout(() => {
    if (!res.headersSent) plainReply(res, 504, `no answer within ${limits.timeoutMs} ms`);
    controller.abort();
  }, limits.timeoutMs);
  try {
    const read = method === "POST" ? await readRaw(req, limits.maxBodyBytes) : undefined;
    if (read !== undefined && !read.ok) return plainReply(res, read.status, read.status === 413 ? `body larger than ${limits.maxBodyBytes} bytes` : "not JSON");
    const prepared: Prepared = read === undefined ? { kind: "send", body: Buffer.alloc(0), failed: [] } : await prepare(relay, read.body, controller.signal);
    if (prepared.kind === "answer") {
      const text = JSON.stringify(prepared.body);
      res.writeHead(200, { "content-type": "application/json", "content-length": String(Buffer.byteLength(text)) }).end(text);
      return;
    }
    let answer: Answer;
    try {
      answer = await send(transfer.upstream, {
        method,
        path: "/mcp",
        headers: { ...requestHeaders(req.headers), ...(method === "POST" ? { "content-length": String(prepared.body.length) } : {}) },
        ...(method === "POST" ? { body: prepared.body } : {}),
        signal: controller.signal,
      });
    } catch (thrown) {
      if (!res.headersSent) plainReply(res, 502, `the upstream could not be reached (${reasonOf(thrown, transfer.upstream)})`);
      return;
    }
    if (answer.status < 200 || answer.status >= 300) return await failure(relay, answer, res);
    if (String(answer.headers["content-type"] ?? "").startsWith("text/event-stream")) return await streamEvents(relay, answer, res, prepared.failed, controller.signal);
    return await holdAnswer(relay, answer, res, prepared.failed, controller.signal);
  } catch (error: unknown) {
    console.error("relay: request failed:", error);
    if (!res.headersSent) plainReply(res, 500, "internal error");
    else res.destroy();
  } finally {
    clearTimeout(timer);
  }
};
