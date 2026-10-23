import { fail, inputError } from "../../domain/errors.js";
import { replyDecision, REPLY_MAX } from "../../domain/reviews.js";
import type { Deps } from "../ports.js";
import { resolvePackage } from "./apps.js";

const checkedText = (text: string, max: number): string => {
  const trimmed = text.trim();
  if (trimmed === "") return fail(inputError("the reply is empty"));
  return [...trimmed].length > max ? fail(inputError(`the reply has ${[...trimmed].length} characters; the store takes at most ${max}`)) : trimmed;
};

/**
 * Publish a reply to an App Store review, under the developer's name and
 * visible to everyone once Apple publishes it. The review is read first: one
 * that already has a different reply is refused unless `replace`, and the same
 * text again sends nothing.
 */
export const replyToAppStoreReview = async (deps: Deps, args: { readonly review: string; readonly text: string; readonly replace: boolean }) => {
  const text = checkedText(args.text, REPLY_MAX.app_store);
  const review = await deps.appStore.review(args.review.trim());
  const decision = replyDecision(review, text, args.replace);
  if ("problem" in decision) return fail(inputError(decision.problem));
  if ("unchanged" in decision) return { review: review.id, changed: false, reply: review.reply, note: "the review already has this reply; nothing was sent" };
  const reply = await deps.appStore.respond(review.id, text);
  return {
    review: review.id,
    changed: true,
    replaced: review.reply !== null,
    reply,
    note: reply.state === "pending" ? "Apple publishes a reply after its own review, usually within a day" : "published under the developer's name",
  };
};

/** Publish a reply to a Play review, under the developer's name and visible to everyone; read first, as for the App Store. */
export const replyToPlayReview = async (deps: Deps, args: { readonly package?: string; readonly review: string; readonly text: string; readonly replace: boolean }) => {
  const packageName = resolvePackage(deps, args.package);
  const text = checkedText(args.text, REPLY_MAX.play);
  const review = await deps.play.review(packageName, args.review.trim());
  const decision = replyDecision(review, text, args.replace);
  if ("problem" in decision) return fail(inputError(decision.problem));
  if ("unchanged" in decision) return { package: packageName, review: review.id, changed: false, reply: review.reply, note: "the review already has this reply; nothing was sent" };
  const reply = await deps.play.reply(packageName, review.id, text);
  return { package: packageName, review: review.id, changed: true, replaced: review.reply !== null, reply, note: "published under the developer's name" };
};
