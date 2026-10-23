import { describe, expect, it } from "vitest";

import { callSignal, inCall, pause, PROGRESS_INTERVAL_MS, progressSender, reportProgress } from "../src/call.js";
import { asGuardError } from "../src/guardErrors.js";

describe("progressSender", () => {
  it("sends progress in increasing order, no more often than the interval, and always the last", async () => {
    const sent: unknown[] = [];
    const clock = { t: 0 };
    const report = progressSender("tok", async (n) => void sent.push(n.params), () => clock.t);
    report(1, 4, "one");
    report(1, 4, "one again");
    clock.t += PROGRESS_INTERVAL_MS - 1;
    report(2, 4);
    clock.t += 1;
    report(2, 4);
    report(0, 4);
    report(4, 4, "done");
    report(5);
    await Promise.resolve();
    expect(sent).toEqual([
      { progressToken: "tok", progress: 1, total: 4, message: "one" },
      { progressToken: "tok", progress: 2, total: 4 },
      { progressToken: "tok", progress: 4, total: 4, message: "done" },
    ]);
  });

  it("never fails the call when the notification cannot be sent", async () => {
    const report = progressSender(7, async () => Promise.reject(new Error("the client is gone")));
    expect(() => report(1, 2)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 1));
  });
});

describe("a call's context", () => {
  it("is nothing outside a call: no signal, progress going nowhere, a pause that just waits", async () => {
    expect(callSignal()).toBeUndefined();
    expect(() => reportProgress(1, 2)).not.toThrow();
    let slept = 0;
    await pause(5, async (ms) => void (slept += ms), "x");
    expect(slept).toBe(5);
  });

  it("ends a pause early when the call is cancelled, as a cancelled failure", async () => {
    const controller = new AbortController();
    const pending = inCall({ signal: controller.signal }, () => pause(60_000, () => new Promise(() => undefined), "the next poll was not made"));
    controller.abort();
    const thrown = await pending.then(() => undefined, (e: unknown) => e);
    expect(asGuardError(thrown)).toEqual({ kind: "cancelled", message: "the client cancelled the call; the next poll was not made" });
  });

  it("keeps each concurrent call's progress to itself", async () => {
    const seen: string[] = [];
    await Promise.all(
      ["a", "b"].map((name) =>
        inCall({ progress: (p) => void seen.push(`${name}${p}`) }, async () => {
          await new Promise((resolve) => setTimeout(resolve, name === "a" ? 5 : 1));
          reportProgress(1);
        }),
      ),
    );
    expect(seen.sort()).toEqual(["a1", "b1"]);
  });
});
