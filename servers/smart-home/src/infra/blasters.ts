import type { BlasterStatus, Blasters } from "../app/ports.js";
import { type Framing, hex4, rmModelOf } from "../domain/broadlink/models.js";
import {
  AUTH,
  AUTH_FAILED,
  authPayload,
  type Cipher,
  COMMAND,
  DEFAULT_KEY,
  encryptedPacket,
  errorText,
  FIRMWARE_REQUEST,
  type Hello,
  helloPacket,
  nextCount,
  NOTHING_YET,
  parseAuth,
  parseFirmware,
  parseHello,
  parseReply,
  PORT,
  type Reply,
  RM,
  rmPayload,
  rmResult,
  type Session,
} from "../domain/broadlink/protocol.js";
import type { Blaster } from "../domain/catalog.js";
import { drift, fail } from "../domain/errors.js";
import type { Exchange, Plan } from "./udp.js";

/**
 * The Blasters port over BroadLink's protocol: hello, then auth, then the
 * command, a new session per operation (nothing is kept between calls, so a
 * blaster that rebooted or was re-locked is simply asked again). A request
 * that cannot happen twice harmfully (hello, auth, a read) is sent again
 * when no answer comes; an IR code is sent once, and silence after it is
 * reported as an unknown outcome, never retried.
 */

export type BlasterOptions = {
  readonly exchange: Exchange;
  readonly cipher: Cipher;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  /** In [0, 1): where each session's message count starts, as python-broadlink picks it. */
  readonly random: () => number;
};

/** Timing: an RM4 mini answered every request within 0.12 s on its own LAN (measured 2026-10-26); a VPN or subnet route adds its round trip. */
const READ: Omit<Plan, "accept"> = { waitMs: 1000, attempts: 4 };
const ONCE: Omit<Plan, "accept"> = { waitMs: 3000, attempts: 1 };
/** A learning window lasts about 25 s on an RM4 mini; it is opened again before that. */
const LEARN_WINDOW_MS = 20_000;
const POLL_MS = 1000;

const macBytes = (mac: string): Uint8Array => Uint8Array.from(mac.split(":"), (b) => parseInt(b, 16));

type Link = {
  readonly hello: Hello;
  readonly framing: Framing;
  /** One encrypted request; undefined when nothing answered, with why. */
  readonly call: (type: number, payload: Uint8Array, plan: Omit<Plan, "accept">) => Promise<Reply | string>;
  readonly decrypt: (body: Uint8Array) => Uint8Array;
};

export const makeBlasters = (options: BlasterOptions): Blasters => {
  const { exchange, cipher } = options;
  const queues = new Map<string, Promise<unknown>>();

  /** One operation per blaster at a time: a second session would end the first one's key. */
  const serial = <T>(blaster: Blaster, work: () => Promise<T>): Promise<T> => {
    const next = (queues.get(blaster.host) ?? Promise.resolve()).then(work, work);
    queues.set(blaster.host, next.catch(() => undefined));
    return next;
  };

  const offline = (blaster: Blaster, why: string): never =>
    fail({ kind: "offline", blaster: blaster.name, message: `blaster "${blaster.name}" at ${blaster.host} does not answer: ${why}` });

  const hello = async (blaster: Blaster): Promise<Hello> => {
    const out = await exchange({ host: blaster.host, port: PORT }, helloPacket(new Date(options.now())), { ...READ, accept: (r) => parseHello(r) !== undefined });
    const answer = out.reply === undefined ? offline(blaster, out.why) : (parseHello(out.reply) ?? fail(drift("a hello answer stopped parsing")));
    if (blaster.mac !== undefined && answer.mac !== blaster.mac) {
      fail({
        kind: "identity",
        blaster: blaster.name,
        expected: blaster.mac,
        found: answer.mac,
        message: `the device at ${blaster.host} is ${answer.mac} ("${answer.name}"), not blaster "${blaster.name}" (${blaster.mac})`,
      });
    }
    return answer;
  };

  const linkTo = (blaster: Blaster, answer: Hello, framing: Framing, session: Session): Link => {
    let count = 0x8000 + Math.floor(options.random() * 0x8000);
    return {
      hello: answer,
      framing,
      decrypt: (body) => cipher.decrypt(session.key, body),
      call: async (type, payload, plan) => {
        count = nextCount(count);
        const sent = count;
        const out = await exchange({ host: blaster.host, port: PORT }, encryptedPacket(session, sent, type, payload, cipher), {
          ...plan,
          accept: (r) => parseReply(r)?.count === sent,
        });
        return out.reply === undefined ? out.why : (parseReply(out.reply) ?? fail(drift("an answer stopped parsing")));
      },
    };
  };

  const locked = (blaster: Blaster, why: string): never => fail({ kind: "locked", blaster: blaster.name, message: `blaster "${blaster.name}" ${why}` });

  const deviceError = (blaster: Blaster, what: string, code: number): never =>
    fail({ kind: "device", blaster: blaster.name, code, message: `blaster "${blaster.name}" refused ${what}: ${errorText(code)} (${code})` });

  /** A session, or "refused" when the blaster answers auth with an authentication failure. */
  const authenticate = async (blaster: Blaster, answer: Hello): Promise<Link | "refused"> => {
    const model = rmModelOf(answer.devtype) ?? fail(drift(`the device at ${blaster.host} is BroadLink type ${hex4(answer.devtype)} ("${answer.name}"), not an RM blaster this server knows`));
    const mac = macBytes(answer.mac);
    const anonymous = linkTo(blaster, answer, model.framing, { devtype: answer.devtype, mac, id: 0, key: DEFAULT_KEY });
    const reply = await anonymous.call(AUTH, authPayload(), READ);
    if (typeof reply === "string") return offline(blaster, `it answered hello, then not auth: ${reply}`);
    if (reply.error === AUTH_FAILED) return "refused";
    if (reply.error !== 0) return deviceError(blaster, "a session", reply.error);
    const grant = parseAuth(anonymous.decrypt(reply.body)) ?? fail(drift("the auth answer is too short to hold a session"));
    return linkTo(blaster, answer, model.framing, { devtype: answer.devtype, mac, id: grant.id, key: grant.key });
  };

  const open = async (blaster: Blaster): Promise<Link> => {
    const answer = await hello(blaster);
    if (answer.locked) return locked(blaster, "is locked: Lock device is on in the BroadLink app");
    const link = await authenticate(blaster, answer);
    return link === "refused" ? locked(blaster, "refuses a session (authentication failed), as it does when Lock device is on in the BroadLink app") : link;
  };

  /** An RM command that must succeed; its result, decrypted. */
  const rm = async (blaster: Blaster, link: Link, what: string, command: number, data: Uint8Array, plan: Omit<Plan, "accept">): Promise<Uint8Array> => {
    const reply = await link.call(COMMAND, rmPayload(link.framing, command, data), plan);
    if (typeof reply === "string") return offline(blaster, `it stopped answering during ${what}: ${reply}`);
    if (reply.error !== 0) return deviceError(blaster, what, reply.error);
    return rmResult(link.framing, link.decrypt(reply.body));
  };

  return {
    status: (blaster) =>
      serial(blaster, async (): Promise<BlasterStatus> => {
        const answer = await hello(blaster);
        const model = rmModelOf(answer.devtype)?.model;
        const base = { mac: answer.mac, devtype: answer.devtype, model, nameOnDevice: answer.name, locked: answer.locked };
        if (answer.locked || model === undefined) return base;
        const link = await authenticate(blaster, answer);
        if (link === "refused") return { ...base, locked: true };
        const reply = await link.call(COMMAND, FIRMWARE_REQUEST, READ);
        if (typeof reply === "string" || reply.error !== 0) return base;
        return { ...base, firmware: parseFirmware(link.decrypt(reply.body)) };
      }),

    send: (blaster, packet) =>
      serial(blaster, async () => {
        const link = await open(blaster);
        const reply = await link.call(COMMAND, rmPayload(link.framing, RM.send, packet), ONCE);
        if (typeof reply === "string") {
          fail({ kind: "outcome_unknown", blaster: blaster.name, message: `blaster "${blaster.name}" did not confirm the code (${reply}); it may or may not have gone out` });
        } else if (reply.error !== 0) {
          deviceError(blaster, "the code", reply.error);
        }
      }),

    learn: (blaster, ms) =>
      serial(blaster, async () => {
        const link = await open(blaster);
        const deadline = options.now() + ms;
        let windowEnds = 0;
        while (options.now() < deadline) {
          if (options.now() >= windowEnds) {
            await rm(blaster, link, "learning", RM.learn, new Uint8Array(), READ);
            windowEnds = options.now() + LEARN_WINDOW_MS;
          }
          await options.sleep(POLL_MS);
          const reply = await link.call(COMMAND, rmPayload(link.framing, RM.captured), READ);
          if (typeof reply === "string") return offline(blaster, `it stopped answering while learning: ${reply}`);
          if (NOTHING_YET.has(reply.error)) continue;
          if (reply.error !== 0) return deviceError(blaster, "to hand over the learned code", reply.error);
          const code = rmResult(link.framing, link.decrypt(reply.body));
          if (code.length > 0) return code;
        }
        return undefined;
      }),
  };
};
