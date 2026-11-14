import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "node:http";
import { StringDecoder } from "node:string_decoder";

import { type Limits, plainReply, readRawBody } from "@foreverworks/mcp-kit";

import { failedCall, inboxPathsIn, messagesOf, toolCallArguments } from "./calls.js";
import { contentEndOf, type Edit, idSourceOf, messageSpans, prepend, type Span, splice, textOf } from "./json.js";
import { dataOf, eventOf, makeSplitter, withData } from "./sse.js";
import { noteOnLinks, type Transfer, uploadFile } from "./transfer.js";
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

const parse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

/** What to do with a POST: answer it here (every call in it failed to get its files across), or send this on, and add these responses to what comes back. */
type Prepared = { readonly kind: "answer"; readonly body: string } | { readonly kind: "send"; readonly body: Buffer; readonly failed: readonly string[] };

const unchanged = (raw: Buffer): Prepared => ({ kind: "send", body: raw, failed: [] });

/**
 * Uploads the inbox files the tool calls in a request name. A call whose file
 * cannot be sent is not made: it is answered with a JSON-RPC error naming the
 * file and why, and the other messages of a batch go on without it. A request
 * that needs nothing of the kind goes on as the very bytes it came in, and one
 * that loses a message loses only that message's text: nothing else in it is
 * written again.
 */
const prepare = async (relay: Relay, raw: Buffer, signal: AbortSignal): Promise<Prepared> => {
  const { inbox } = relay.transfer;
  if (inbox === undefined) return unchanged(raw);
  const text = raw.toString("utf8");
  const body = parse(text);
  const spans = body === undefined ? undefined : messageSpans(text);
  const messages = messagesOf(body);
  if (body === undefined || spans === undefined || spans.length !== messages.length) return unchanged(raw);
  const calls = messages.map((message) => {
    const call = toolCallArguments(message);
    return call === undefined ? undefined : { paths: inboxPathsIn(call.arguments, inbox) };
  });
  const paths = [...new Set(calls.flatMap((call) => call?.paths ?? []))];
  if (paths.length === 0) return unchanged(raw);

  const refused = new Map<string, string>();
  for (const path of paths) {
    const moved = await uploadFile(relay.transfer, path, signal);
    if (!moved.ok) refused.set(path, moved.reason);
  }
  const failed = messages.map((_message, at) => {
    const path = calls[at]?.paths.find((p) => refused.has(p));
    const id = idSourceOf(text, spans[at] as Span);
    return path === undefined || id === undefined ? undefined : failedCall(id, `The relay could not send ${path} to the server, so the call was not made: ${refused.get(path) as string}`);
  });
  const answers = failed.filter((answer) => answer !== undefined);
  if (answers.length === 0) return unchanged(raw);
  if (answers.length === messages.length) return { kind: "answer", body: Array.isArray(body) ? `[${answers.join(",")}]` : (answers[0] as string) };
  const kept = spans.filter((_span, at) => failed[at] === undefined).map((span) => textOf(text, span));
  return { kind: "send", body: Buffer.from(`[${kept.join(",")}]`), failed: answers };
};

/**
 * The text of a response (or of a batch of them) with a note added to each
 * result that links files the relay could not bring over, after it has fetched
 * the ones it could. The note goes into the text where it belongs; everything
 * else is the characters it was. The same text when there is nothing to add,
 * and undefined for text that is not JSON.
 */
const annotate = async (relay: Relay, text: string, signal: AbortSignal): Promise<string | undefined> => {
  const body = parse(text);
  if (body === undefined) return undefined;
  const messages = messagesOf(body);
  const spans = messageSpans(text);
  if (spans === undefined || spans.length !== messages.length) return text;
  const edits: Edit[] = [];
  for (const [at, message] of messages.entries()) {
    const note = await noteOnLinks(relay.transfer, message, signal);
    const place = note === undefined ? undefined : contentEndOf(text, spans[at] as Span);
    if (note !== undefined && place !== undefined) edits.push({ at: place.at, insert: `${place.after ? "," : ""}${JSON.stringify({ type: "text", text: note })}` });
  }
  return edits.length === 0 ? text : splice(text, edits);
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
const streamEvents = async (relay: Relay, answer: Answer, res: ServerResponse, failed: readonly string[], signal: AbortSignal): Promise<void> => {
  res.writeHead(answer.status, { ...answerHeaders(answer.headers), "content-type": "text/event-stream" });
  res.flushHeaders();
  for (const response of failed) await writeAndWait(res, eventOf(response));
  const rewrite = async (event: string): Promise<string> => {
    const data = relay.transfer.outbox === undefined ? undefined : dataOf(event);
    if (data === undefined || !data.includes(NEEDS_FETCH)) return event;
    const annotated = await annotate(relay, data, signal);
    return annotated === undefined || annotated === data ? event : withData(event, annotated);
  };
  const decoder = new StringDecoder("utf8");
  const splitter = makeSplitter(MAX_HELD);
  try {
    for await (const chunk of answer.body as AsyncIterable<Buffer>) {
      const cut = splitter.push(decoder.write(chunk));
      for (const event of cut.events) await writeAndWait(res, await rewrite(event));
      if (cut.overflow) {
        // An event that never ends is not one to hold: the stream stops after the last whole event.
        relay.transfer.log(`relay-warning ${JSON.stringify({ message: `an event of the upstream's stream is longer than ${MAX_HELD} bytes without a blank line; the stream was ended there` })}`);
        answer.body.destroy();
        res.end();
        return;
      }
    }
    const last = splitter.push(decoder.end());
    for (const event of last.events) await writeAndWait(res, await rewrite(event));
    const rest = splitter.finish();
    if (rest !== "") await writeAndWait(res, rest);
    res.end();
  } catch {
    // The upstream or the client went away mid-stream: what was sent stays sent, and the stream ends where it is.
    res.destroy();
  }
};

/**
 * A whole answer. It goes on as the very bytes it came in, unless there is
 * something to add: a note on a result whose linked files could not be
 * brought over (spliced into its text), or the responses of calls that were
 * not made (put in front; and alone, when the upstream's answer has no JSON,
 * as the 202 to a batch whose only other message was a notification).
 */
const holdAnswer = async (relay: Relay, answer: Answer, res: ServerResponse, failed: readonly string[], signal: AbortSignal): Promise<void> => {
  const body = await readAnswer(answer, MAX_HELD);
  if (body === undefined) return plainReply(res, 502, `the upstream's answer is larger than ${MAX_HELD} bytes, which is more than the relay holds`);
  const json = String(answer.headers["content-type"] ?? "").startsWith("application/json");
  const text = body.toString("utf8");
  const looksAt = json && relay.transfer.outbox !== undefined && text.includes(NEEDS_FETCH);
  const annotated = looksAt ? await annotate(relay, text, signal) : undefined;
  const sent = annotated ?? text;
  const headers = answerHeaders(answer.headers);
  if (failed.length === 0) {
    const out = annotated === undefined || annotated === text ? body : Buffer.from(annotated);
    res.writeHead(answer.status, { ...headers, "content-length": String(out.length) });
    res.end(out);
    return;
  }
  const hasJson = json && parse(text) !== undefined;
  const out = Buffer.from(hasJson ? prepend(sent, failed) : `[${failed.join(",")}]`);
  res.writeHead(hasJson ? answer.status : 200, { ...headers, "content-type": "application/json", "content-length": String(out.length) });
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
    const read = method === "POST" ? await readRawBody(req, limits.maxBodyBytes) : undefined;
    if (read !== undefined && !read.ok) return plainReply(res, read.status, read.status === 413 ? `body larger than ${limits.maxBodyBytes} bytes` : read.status === 408 ? "request took too long to arrive" : "not JSON");
    const prepared: Prepared = read === undefined ? { kind: "send", body: Buffer.alloc(0), failed: [] } : await prepare(relay, read.body, controller.signal);
    if (prepared.kind === "answer") {
      res.writeHead(200, { "content-type": "application/json", "content-length": String(Buffer.byteLength(prepared.body)) }).end(prepared.body);
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
