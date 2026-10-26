/**
 * The protocol against python-broadlink's own bytes (test/fixtures, made
 * offline for an invented device), and the IR codec against what a real
 * capture looks like: jittered durations, marks longer than spaces, repeat
 * codes after the frame.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { rmModelOf } from "../src/domain/broadlink/models.js";
import * as P from "../src/domain/broadlink/protocol.js";
import { decodeNec, encodeNec, sameAsPlainAddress } from "../src/domain/ir/nec.js";
import { decodeIrPacket, encodeIrPacket, microsecondsOf, unitsOf } from "../src/domain/ir/packet.js";
import { aes } from "../src/infra/cipher.js";

const vectors = JSON.parse(readFileSync(new URL("./fixtures/python-broadlink.json", import.meta.url), "utf8")) as Record<string, string>;
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString("hex");
const bytes = (text: string): Uint8Array => Uint8Array.from(Buffer.from(text, "hex"));
const MAC = Uint8Array.of(0x02, 0, 0, 0, 0, 0x01);

describe("the BroadLink protocol, byte for byte with python-broadlink", () => {
  it("packs the hello", () => {
    expect(hex(P.helloPacket(new Date(Date.UTC(2026, 9, 26, 1, 3))))).toBe(vectors["hello_2026_10_26T01_03Z"]);
  });

  it("packs the auth request under the default key", () => {
    const anonymous = { devtype: 0x520c, mac: MAC, id: 0, key: P.DEFAULT_KEY };
    expect(hex(P.encryptedPacket(anonymous, 0x9001, P.AUTH, P.authPayload(), aes))).toBe(vectors["auth_count_9001"]);
  });

  it("packs an RM4 send and a check for a learned code under a session key", () => {
    const session = { devtype: 0x520c, mac: MAC, id: 7, key: bytes(vectors["session_key"] ?? "") };
    const framing = rmModelOf(0x520c)?.framing ?? "plain";
    expect(framing).toBe("sized");
    expect(hex(P.encryptedPacket(session, 0x9002, P.COMMAND, P.rmPayload(framing, P.RM.send, bytes(vectors["ir"] ?? "")), aes))).toBe(vectors["send_data_count_9002_id_7"]);
    expect(hex(P.encryptedPacket(session, 0x9003, P.COMMAND, P.rmPayload(framing, P.RM.captured), aes))).toBe(vectors["check_data_count_9003_id_7"]);
  });

  it("reads a reply's error and count, and refuses one whose checksum is wrong", () => {
    const reply = new Uint8Array(0x48);
    reply[0x22] = 0xf6; // -10
    reply[0x23] = 0xff;
    reply[0x28] = 0x03;
    reply[0x29] = 0x90;
    const sum = P.checksum(reply);
    reply[0x20] = sum & 0xff;
    reply[0x21] = sum >> 8;
    expect(P.parseReply(reply)).toMatchObject({ error: -10, count: 0x9003 });
    reply[0x40] = 1;
    expect(P.parseReply(reply)).toBeUndefined();
  });

  it("reads a hello answer: type, MAC in printed order, name, lock flag", () => {
    const answer = new Uint8Array(0x80);
    answer[0x34] = 0x0c;
    answer[0x35] = 0x52;
    answer.set([0x01, 0, 0, 0, 0, 0x02], 0x3a);
    answer.set(new TextEncoder().encode("Living room"), 0x40);
    answer[0x7f] = 1;
    expect(P.parseHello(answer)).toEqual({ devtype: 0x520c, mac: "02:00:00:00:00:01", name: "Living room", locked: true });
    expect(P.parseHello(answer.subarray(0, 0x50))).toBeUndefined();
  });
});

/** A press as a blaster records it: each duration off by up to two units, marks a unit long. */
const captured = (us: readonly number[], seed = 7): number[] => {
  let s = seed;
  const jitter = (): number => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return (s % 5) - 2;
  };
  return us.map((d, i) => Math.max(1, unitsOf(d) + jitter() + (i % 2 === 0 ? 1 : -1)));
};

describe("the IR codec", () => {
  it("round-trips NEC through the blaster's packet, plain and extended", () => {
    for (const code of [
      { address: 0x00, command: 0x46 },
      { address: 0x04, command: 0x08 },
      { address: 0x1234, command: 0x12 },
    ]) {
      const packet = encodeIrPacket({ durations: encodeNec(code, 1).map(unitsOf), repeat: 0 });
      const back = decodeIrPacket(packet);
      expect(back?.repeat).toBe(0);
      expect(decodeNec((back?.durations ?? []).map(microsecondsOf))).toEqual({ ...code, extended: code.address > 0xff, repeats: 1 });
    }
    // 0xbf40's high byte is its low byte's inverse: on the air it is plain address 0x40
    expect(sameAsPlainAddress(0xbf40)).toBe(true);
    expect(sameAsPlainAddress(0x1234)).toBe(false);
  });

  it("decodes a jittered capture with repeat codes, ignoring zero padding after its length", () => {
    const durations = captured(encodeNec({ address: 0x00, command: 0x18 }, 3));
    const packet = encodeIrPacket({ durations, repeat: 0 });
    const padded = new Uint8Array(packet.length + 12);
    padded.set(packet);
    const back = decodeIrPacket(padded);
    expect(back?.durations).toEqual(durations);
    expect(decodeNec((back?.durations ?? []).map(microsecondsOf))).toEqual({ address: 0x00, command: 0x18, extended: false, repeats: 3 });
  });

  it("writes long durations in the three-byte form", () => {
    expect([...encodeIrPacket({ durations: [290, 145, 3333], repeat: 0 })]).toEqual([0x26, 0x00, 0x07, 0x00, 0x00, 0x01, 0x22, 0x91, 0x00, 0x0d, 0x05]);
  });

  it("finds no NEC code in another protocol or in a frame whose command check fails", () => {
    const sony = [2400, 600, ...Array.from({ length: 24 }, (_, i) => (i % 2 === 0 ? 1200 : 600)), 25_000];
    expect(decodeNec(sony)).toBeUndefined();
    const frame = [...encodeNec({ address: 0, command: 0x46 }, 0)];
    frame[2 + 16 * 2 + 1] = 1687.5; // first bit of the command's inverse flipped to 1: the check fails
    expect(decodeNec(frame)).toBeUndefined();
    expect(decodeIrPacket(Uint8Array.of(0xb2, 0, 2, 0, 10, 10))).toBeUndefined();
  });
});
