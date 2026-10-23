import { compact } from "@foreverworks/mcp-kit";

import { fail, inputError } from "../../domain/errors.js";
import { parseId, toId } from "../../domain/ids.js";
import { toComment } from "../../domain/models.js";
import type { Deps } from "../ports.js";

/** The open comments on a page, oldest first, as Notion lists them. */
export const getComments = async (deps: Deps, args: { readonly page: string; readonly limit: number; readonly cursor?: string; readonly account?: string }) => {
  const id = toId(args.page, "page");
  const account = await deps.locator.accountOf(id, ["page"], args.account);
  const listed = await deps.accounts.api(account).listComments(id, args.limit, args.cursor);
  return compact({
    account,
    page: id,
    comments: listed.results.map(toComment),
    nextCursor: listed.has_more ? (listed.next_cursor ?? undefined) : undefined,
  });
};

/**
 * A comment on a page, in Markdown, starting a discussion, or a reply in one
 * (`discussion`, from get_comments). The page is asked for either way: it is
 * how the workspace is found, since a discussion id cannot be looked up.
 */
export const addComment = async (deps: Deps, args: { readonly page: string; readonly markdown: string; readonly discussion?: string; readonly account?: string }) => {
  if (args.markdown.trim() === "") return fail(inputError("markdown is empty; there is nothing to say"));
  const id = toId(args.page, "page");
  const account = await deps.locator.accountOf(id, ["page"], args.account);
  const discussionId = args.discussion === undefined ? undefined : (parseId(args.discussion) ?? fail(inputError(`discussion "${args.discussion}" is not an id from get_comments`)));
  const made = await deps.accounts.api(account).addComment(discussionId === undefined ? { pageId: id } : { discussionId }, args.markdown);
  return { account, page: id, ...toComment(made) };
};
