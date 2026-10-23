import { connect } from "node:net";

import type { DoorPort } from "../app/ports.js";
import { fail, hostError } from "../domain/errors.js";
import { parsePackages } from "./adb.js";

/**
 * adb's DEVICE protocol, spoken straight to a slot's adbd through its tunnel on this machine's loopback
 * (127.0.0.1:<door> -> the host -> the slot's adbd). No adb server sits in between, so nothing here can
 * start one, adopt another session's devices, or hold a device open after the call: one connection per
 * command, closed when the command's stream closes.
 *
 * The protocol (adb's protocol.txt): 24-byte little-endian headers (command, arg0, arg1, data length,
 * data checksum, command ^ 0xffffffff) and a payload. CNXN both ways (the slot's adbd must not ask for
 * AUTH: ro.adb.secure=0, so the tunnel's own authentication, mutual TLS say, is the boundary), then
 * OPEN a `shell:` stream, acknowledge every WRTE with an OKAY, and read until CLSE.
 */

const A_CNXN = 0x4e584e43;
const A_OPEN = 0x4e45504f;
const A_OKAY = 0x59414b4f;
const A_CLSE = 0x45534c43;
const A_WRTE = 0x45545257;
const A_AUTH = 0x48545541;
/** Version 0x01000001: checksums may be zero (adb's A_VERSION_SKIP_CHECKSUM). */
const VERSION = 0x01000001;
const MAX_PAYLOAD = 256 * 1024;
const LOCAL_ID = 1;

const sum = (data: Buffer): number => data.reduce((a, b) => (a + b) >>> 0, 0);

export const message = (command: number, arg0: number, arg1: number, data: Buffer = Buffer.alloc(0)): Buffer => {
  const header = Buffer.alloc(24);
  header.writeUInt32LE(command, 0);
  header.writeUInt32LE(arg0, 4);
  header.writeUInt32LE(arg1, 8);
  header.writeUInt32LE(data.length, 12);
  header.writeUInt32LE(sum(data), 16);
  header.writeUInt32LE((command ^ 0xffffffff) >>> 0, 20);
  return Buffer.concat([header, data]);
};

export type Message = { readonly command: number; readonly arg0: number; readonly arg1: number; readonly data: Buffer };

/** Splits whole messages off the front of a buffer; what is left is an incomplete one. */
export const readMessages = (buffer: Buffer): { readonly messages: readonly Message[]; readonly rest: Buffer } => {
  const messages: Message[] = [];
  let at = 0;
  while (buffer.length - at >= 24) {
    const length = buffer.readUInt32LE(at + 12);
    if (buffer.length - at < 24 + length) break;
    messages.push({ command: buffer.readUInt32LE(at), arg0: buffer.readUInt32LE(at + 4), arg1: buffer.readUInt32LE(at + 8), data: buffer.subarray(at + 24, at + 24 + length) });
    at += 24 + length;
  }
  return { messages, rest: buffer.subarray(at) };
};

const talk = (port: number, command: string, timeoutMs: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    let buffer: Buffer = Buffer.alloc(0);
    let remote: number | undefined;
    const out: Buffer[] = [];
    let finished = false;
    const done = (error?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      if (error === undefined) resolve(Buffer.concat(out).toString("utf8"));
      else reject(new Error(error));
    };
    const timer = setTimeout(() => done(`no answer in ${timeoutMs} ms`), timeoutMs);
    socket.on("connect", () => socket.write(message(A_CNXN, VERSION, MAX_PAYLOAD, Buffer.from("host::\0"))));
    socket.on("data", (chunk: Buffer) => {
      const { messages, rest } = readMessages(Buffer.concat([buffer, chunk]));
      buffer = rest;
      for (const m of messages) {
        if (m.command === A_AUTH) return done("adbd asked for a key: this door's device enforces adb authentication");
        if (m.command === A_CNXN) socket.write(message(A_OPEN, LOCAL_ID, 0, Buffer.from(`shell:${command}\0`)));
        else if (m.command === A_OKAY && m.arg1 === LOCAL_ID) remote = m.arg0;
        else if (m.command === A_WRTE && m.arg1 === LOCAL_ID) {
          out.push(m.data);
          socket.write(message(A_OKAY, LOCAL_ID, m.arg0));
        } else if (m.command === A_CLSE && m.arg1 === LOCAL_ID) {
          if (remote === undefined) return done(`adbd refused shell:${command.split(" ")[0] ?? ""}`);
          return done();
        }
      }
    });
    socket.on("end", () => done(remote === undefined ? "closed before the shell opened (the slot is stopped, or its door is closed)" : undefined));
    socket.on("error", (e) => done(e.message));
  });

/** One shell command on the slot behind 127.0.0.1:<port>; its output, or a tagged host failure. */
export const doorShell = (port: number, command: string, timeoutMs = 15_000): Promise<string> =>
  talk(port, command, timeoutMs).catch((e: unknown) => fail(hostError(`door 127.0.0.1:${port}`, (e as Error).message ?? String(e))));

export const makeDoor = (timeoutMs = 15_000): DoorPort => {
  const shell = (port: number, command: string) => doorShell(port, command, timeoutMs);
  return {
    bootCompleted: async (port) => (await shell(port, "getprop sys.boot_completed").catch(() => "")).trim() === "1",
    clearUserApps: async (port) => {
      const packages = parsePackages(await shell(port, "pm list packages -3"));
      for (const p of packages) await shell(port, `pm clear ${p}`);
      return packages.length;
    },
  };
};
