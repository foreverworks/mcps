import { mkdir } from "node:fs/promises";

import { fail, hostError } from "../domain/errors.js";
import { run } from "./run.js";

/**
 * One command on a host over ssh, as the broker's own user: its ssh configuration (a key, or an
 * identity-based SSH such as Tailscale SSH) must let it in without a prompt. BatchMode makes a refusal
 * fail at once instead of waiting for a password that never comes. known_hosts lives in the state
 * directory, created on first use, so a service without a home of its own still remembers host keys.
 */
export const makeSsh = (stateDir: string) => {
  let ready: Promise<unknown> | undefined;
  const base = [
    "ssh",
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "ServerAliveInterval=10",
    "-o", "ServerAliveCountMax=3",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `UserKnownHostsFile=${stateDir}/known_hosts`,
    "-o", "LogLevel=ERROR",
  ];
  return async (target: string, command: string, timeoutMs = 60_000): Promise<string> => {
    ready ??= mkdir(stateDir, { recursive: true, mode: 0o700 }).catch(() => undefined);
    await ready;
    const r = await run([...base, target, command], { timeoutMs });
    if (r.code !== 0) return fail(hostError(target, `exit ${r.code}: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`));
    return r.stdout;
  };
};

export type Ssh = ReturnType<typeof makeSsh>;

/** Single-quotes a value for the remote shell. */
export const sq = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;
