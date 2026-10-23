/**
 * The Gmail writes the policy declares idempotent (packages/mcp-kit, policy.ts),
 * which tells clients they may repeat one. Each, run twice with the same
 * arguments, sends Gmail the same absolute change both times (these labels on,
 * those off; this message into the trash), never one worked out from what the
 * first call left, so the second call changes nothing more. A write newly
 * declared idempotent fails the first test until it has its case here.
 */
import { idempotentWrites } from "@foreverworks/mcp-kit";

import { TASKS } from "../../src/tasks/policy.js";
import { describe, expect, it } from "vitest";

import type { Deps } from "../../src/gmail/app/ports.js";
import { markSpam, modifyLabels, trash, unmarkSpam, untrash } from "../../src/gmail/app/usecases/organize.js";
import { POLICY } from "../../src/mcp/policy.js";
import { depsWith, gmailStub, writeStub } from "./fakes.js";

const labels = async () => ({
  labels: [
    { id: "INBOX", name: "INBOX", type: "system" },
    { id: "SPAM", name: "SPAM", type: "system" },
    { id: "Label_7", name: "Clients/Acme", type: "user" },
  ],
});

/** Deps whose write port records every request it is sent. */
const recording = () => {
  const sent: unknown[] = [];
  const write = writeStub({
    modifyMessages: async (ids, change) => void sent.push(["modifyMessages", ids, change]),
    modifyThread: async (id, change) => (sent.push(["modifyThread", id, change]), {}),
    trash: async (target, id) => (sent.push(["trash", target, id]), {}),
    untrash: async (target, id) => (sent.push(["untrash", target, id]), {}),
  });
  return { sent, deps: depsWith({ gmail: gmailStub({ labels }), write }) };
};

const CASES: Readonly<Record<string, (deps: Deps) => Promise<unknown>>> = {
  modify_labels: (deps) => modifyLabels(deps, { target: "thread", ids: ["t1", "t2"], add: ["clients/acme"], remove: ["inbox"] }),
  mark_spam: (deps) => markSpam(deps, { target: "message", ids: ["m1", "m2"] }),
  unmark_spam: (deps) => unmarkSpam(deps, { target: "thread", ids: ["t1"] }),
  trash: (deps) => trash(deps, { target: "message", ids: ["m1"] }),
  untrash: (deps) => untrash(deps, { target: "thread", ids: ["t1", "t2"] }),
};

describe("idempotent Gmail writes", () => {
  it("has a case for every write the policy declares idempotent", () => {
    // Tasks' idempotent writes have their own cases (test/tasks/tasks.test.ts).
    expect(Object.keys(CASES).sort()).toEqual(idempotentWrites(POLICY).filter((name) => !(name in TASKS)));
  });

  it.each(Object.keys(CASES))("%s sends the same absolute change again, and answers the same", async (name) => {
    const run = CASES[name] as (deps: Deps) => Promise<unknown>;
    const { sent, deps } = recording();
    const first = await run(deps);
    const once = sent.length;
    const second = await run(deps);
    expect(once).toBeGreaterThan(0);
    expect(sent.slice(once)).toEqual(sent.slice(0, once));
    expect(second).toEqual(first);
  });
});
