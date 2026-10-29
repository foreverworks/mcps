import { describe, expect, it } from "vitest";

import { run } from "../src/run.js";

describe("run", () => {
  it("answers the exit code and the output, and 127 for a program that is not there", async () => {
    expect(await run(["sh", "-c", "echo out; echo err >&2; exit 3"], { timeoutMs: 5_000 })).toEqual({ code: 3, stdout: "out\n", stderr: "err\n", truncated: false });
    expect((await run(["no-such-program-here"], { timeoutMs: 5_000 })).code).toBe(127);
  });

  it("kills the program's own children at the deadline instead of waiting for them", async () => {
    const started = Date.now();
    const r = await run(["sh", "-c", "sleep 30 & sleep 30"], { timeoutMs: 300 });
    expect(r.code).toBe(124);
    expect(r.stderr).toMatch(/killed by SIGKILL after 300 ms/u);
    expect(Date.now() - started).toBeLessThan(4_000);
  });

  it("says when output went past the cap", async () => {
    const r = await run(["sh", "-c", "head -c 5000 /dev/zero"], { timeoutMs: 5_000, maxBytes: 1024 });
    expect(r.code).toBe(0);
    expect(r.truncated).toBe(true);
    expect(r.stdout.length).toBeLessThanOrEqual(5000);
  });
});
