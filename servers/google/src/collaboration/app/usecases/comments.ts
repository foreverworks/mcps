import { fileIdFrom } from "../../../editors/domain/ids.js";
import { fail, inputError } from "../../domain/errors.js";
import { commentView, replyView } from "../../domain/view.js";
import type { Deps } from "../ports.js";

export type ListArgs = {
  readonly fileId: string;
  readonly includeResolved: boolean;
  readonly includeDeleted: boolean;
  /** RFC 3339: only comments changed since (a reply counts). */
  readonly modifiedAfter: string;
  readonly limit: number;
};

/** A file's comment threads, each with its replies; open ones counted. */
export const listComments = async (deps: Deps, args: ListArgs) => {
  const id = fileIdFrom(args.fileId);
  const raw = await deps.drive.drive.listComments(id, {
    includeDeleted: args.includeDeleted,
    limit: args.limit,
    ...(args.modifiedAfter ? { modifiedAfter: args.modifiedAfter } : {}),
  });
  const comments = raw.filter((c) => args.includeResolved || !c.resolved).map(commentView);
  return { fileId: id, open: raw.filter((c) => !c.resolved && !c.deleted).length, resolved: raw.filter((c) => c.resolved).length, comments };
};

export const addComment = async (deps: Deps, args: { readonly fileId: string; readonly content: string; readonly quoted: string; readonly anchor: string }) => {
  const id = fileIdFrom(args.fileId);
  const made = await deps.drive.drive.createComment(id, {
    content: args.content,
    ...(args.quoted ? { quoted: args.quoted } : {}),
    ...(args.anchor ? { anchor: args.anchor } : {}),
  });
  return { fileId: id, ...commentView(made) };
};

/** A reply, a resolve or a reopen, or a reply that resolves: what the comment box's buttons do. */
export const replyToComment = async (
  deps: Deps,
  args: { readonly fileId: string; readonly commentId: string; readonly content: string; readonly action: "" | "resolve" | "reopen" },
) => {
  if (!args.content.trim() && !args.action) return fail(inputError("give content, action, or both: an empty reply says nothing"));
  const id = fileIdFrom(args.fileId);
  const made = await deps.drive.drive.createReply(id, args.commentId, {
    ...(args.content.trim() ? { content: args.content } : {}),
    ...(args.action ? { action: args.action } : {}),
  });
  return { fileId: id, commentId: args.commentId, ...replyView(made) };
};

/** A comment's text, or a reply's when reply_id is given. Drive lets an account edit only what it wrote. */
export const editComment = async (deps: Deps, args: { readonly fileId: string; readonly commentId: string; readonly replyId: string; readonly content: string }) => {
  const id = fileIdFrom(args.fileId);
  if (args.replyId) {
    return { fileId: id, commentId: args.commentId, ...replyView(await deps.drive.drive.updateReply(id, args.commentId, args.replyId, args.content)) };
  }
  return { fileId: id, ...commentView(await deps.drive.drive.updateComment(id, args.commentId, args.content)) };
};

/** A comment with its replies, or one reply. Drive keeps the thread's place, marked deleted. */
export const deleteComment = async (deps: Deps, args: { readonly fileId: string; readonly commentId: string; readonly replyId: string }) => {
  const id = fileIdFrom(args.fileId);
  if (args.replyId) await deps.drive.drive.deleteReply(id, args.commentId, args.replyId);
  else await deps.drive.drive.deleteComment(id, args.commentId);
  return { fileId: id, commentId: args.commentId, ...(args.replyId ? { replyId: args.replyId } : {}), deleted: true };
};
