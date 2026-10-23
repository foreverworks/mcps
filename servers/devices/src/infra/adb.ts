import { connect } from "node:net";

import type { AdbDevice, AdbPort } from "../app/ports.js";
import { fail, hostError } from "../domain/errors.js";

/**
 * A client of adb's host protocol over TCP, instead of the `adb` binary. The
 * binary STARTS a server when none answers on the port it is given, and on a
 * port meant for a forward of a remote host's adb server that would squat the
 * forward; a socket that finds nothing just fails. The protocol: a 4-hex-digit
 * length and the request; the server answers OKAY or FAIL (+ length + message).
 */

const frame = (payload: string): string => `${payload.length.toString(16).padStart(4, "0")}${payload}`;

type Conversation = { readonly steps: readonly string[]; readonly read: "length" | "eof" };

const talk = (port: number, conversation: Conversation, timeoutMs: number): Promise<string> =>
  new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port });
    let buffer = Buffer.alloc(0);
    let step = 0;
    let finished = false;
    const done = (error?: Error, value?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.destroy();
      if (error !== undefined) reject(error);
      else resolve(value ?? "");
    };
    const timer = setTimeout(() => done(new Error(`adb on 127.0.0.1:${port}: no answer in ${timeoutMs} ms`)), timeoutMs);
    const send = () => socket.write(frame(conversation.steps[step] ?? ""));
    // After the last OKAY: either a length-prefixed answer (host services) or everything until close (shell).
    let answering = false;
    const parse = () => {
      for (;;) {
        if (!answering) {
          if (buffer.length < 4) return;
          const word = buffer.subarray(0, 4).toString("ascii");
          if (word === "FAIL") {
            if (buffer.length < 8) return;
            const len = Number.parseInt(buffer.subarray(4, 8).toString("ascii"), 16);
            if (buffer.length < 8 + len) return;
            done(new Error(`adb: ${buffer.subarray(8, 8 + len).toString("utf8")}`));
            return;
          }
          if (word !== "OKAY") {
            done(new Error(`adb: unexpected reply ${JSON.stringify(word)}`));
            return;
          }
          buffer = buffer.subarray(4);
          step += 1;
          if (step < conversation.steps.length) {
            send();
            continue;
          }
          answering = true;
        }
        if (conversation.read === "length") {
          if (buffer.length < 4) return;
          const len = Number.parseInt(buffer.subarray(0, 4).toString("ascii"), 16);
          if (buffer.length < 4 + len) return;
          done(undefined, buffer.subarray(4, 4 + len).toString("utf8"));
        }
        return;
      }
    };
    socket.on("connect", send);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      parse();
    });
    socket.on("end", () => {
      if (answering && conversation.read === "eof") done(undefined, buffer.toString("utf8"));
      else done(new Error(`adb on 127.0.0.1:${port}: closed early`));
    });
    socket.on("error", (e) => done(e));
  });

export const parseDevices = (text: string): readonly AdbDevice[] =>
  text
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .filter((cols) => cols.length >= 2 && cols[0] !== "")
    .map((cols) => ({ serial: cols[0] ?? "", state: cols[1] ?? "" }));

/** Package names from `pm list packages`. */
export const parsePackages = (text: string): readonly string[] =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("package:"))
    .map((l) => l.slice("package:".length))
    .filter((p) => /^[A-Za-z0-9_.]+$/.test(p));

/** One shell command on a device, through the server on `port`; its output. */
export const adbShell = (port: number, serial: string, command: string, timeoutMs = 15_000): Promise<string> =>
  talk(port, { steps: [`host:transport:${serial}`, `shell:${command}`], read: "eof" }, timeoutMs).catch((e: unknown) =>
    fail(hostError(`adb ${port}/${serial}`, String((e as Error).message ?? e))),
  );

export const makeAdb = (timeoutMs = 15_000): AdbPort => {
  const shell = (port: number, serial: string, command: string) => adbShell(port, serial, command, timeoutMs);
  return {
    devices: async (port) => parseDevices(await talk(port, { steps: ["host:devices"], read: "length" }, 5_000)),
    bootCompleted: async (port, serial) => (await shell(port, serial, "getprop sys.boot_completed").catch(() => "")).trim() === "1",
    clearUserApps: async (port, serial) => {
      const packages = parsePackages(await shell(port, serial, "pm list packages -3"));
      for (const p of packages) await shell(port, serial, `pm clear ${p}`);
      return packages.length;
    },
  };
};
