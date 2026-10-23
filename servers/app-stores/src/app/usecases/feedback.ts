import { compact } from "@foreverworks/mcp-kit";

import { fail, inputError } from "../../domain/errors.js";
import { type FeedbackKind, headOf, newestFirst } from "../../domain/feedback.js";
import type { Deps } from "../ports.js";
import { resolveAscApp } from "./apps.js";

/**
 * What testers sent from TestFlight: screenshot feedback and crash feedback,
 * newest first. One kind pages with a cursor; both at once read `limit` of
 * each and merge them.
 */
export const listFeedback = async (deps: Deps, args: { readonly app?: string; readonly kind?: FeedbackKind; readonly limit: number; readonly cursor?: string }) => {
  if (args.cursor !== undefined && args.kind === undefined) return fail(inputError("a cursor belongs to one kind: give kind as well (crash or screenshot)"));
  const app = await resolveAscApp(deps, args.app);
  const head = { app: { id: app.id, bundleId: app.bundleId, name: app.name } };
  if (args.kind !== undefined) {
    const page = await deps.appStore.feedback(app.id, args.kind, compact({ limit: args.limit, cursor: args.cursor }));
    return { ...head, feedback: page.items, ...compact({ nextCursor: page.nextCursor }) };
  }
  const [crashes, screenshots] = await Promise.all([deps.appStore.feedback(app.id, "crash", { limit: args.limit }), deps.appStore.feedback(app.id, "screenshot", { limit: args.limit })]);
  const more = [crashes.nextCursor === undefined ? [] : ["crash"], screenshots.nextCursor === undefined ? [] : ["screenshot"]].flat();
  return { ...head, feedback: newestFirst([...crashes.items, ...screenshots.items]), ...(more.length === 0 ? {} : { more: `there is more ${more.join(" and ")} feedback: ask for one kind to page through it` }) };
};

/** A crash submission's log, saved whole to the outbox; the answer names the file and shows its first lines. */
export const crashLog = async (deps: Deps, args: { readonly submission: string }) => {
  const id = args.submission.trim();
  const log = await deps.appStore.crashLog(id);
  const saved = await deps.outbox.save(`testflight-crash-${id.replace(/[^A-Za-z0-9-]/g, "_")}.txt`, new TextEncoder().encode(log));
  return { submission: id, ...saved, lines: log.split(/\r?\n/).length, head: headOf(log) };
};
