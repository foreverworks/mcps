import { type ContentEdit, insertEdit, replaceEdit, updateEdit } from "../../domain/content.js";
import { toId } from "../../domain/ids.js";
import { pageTitle } from "../../domain/properties/read.js";
import type { Deps, NotionPort } from "../ports.js";

/**
 * A page's body, changed through Notion's Markdown endpoint. Notion answers
 * with the page's Markdown afterwards, which can be long; what comes back is
 * its size and whether Notion cut it, and read_page shows the text.
 */
type Target = { readonly page: string; readonly account?: string };

const apply = async (deps: Deps, target: Target, edit: ContentEdit) => {
  const id = toId(target.page, "page");
  const account = await deps.locator.accountOf(id, ["page"], target.account);
  const after = await deps.accounts.api(account).editContent(id, edit);
  return { account, id, characters: after.markdown.length, ...(after.truncated ? { contentTruncated: true } : {}) };
};

export const appendContent = (deps: Deps, args: Target & { readonly markdown: string; readonly at: "start" | "end"; readonly after?: string }) =>
  apply(deps, args, insertEdit(args.markdown, args.at, args.after));

export const editPageContent = (
  deps: Deps,
  args: Target & { readonly edits: readonly { readonly old: string; readonly new: string; readonly all: boolean }[]; readonly allowDeleting: boolean },
) => apply(deps, args, updateEdit(args.edits, args.allowDeleting));

/** Notion's most blocks in one page of children. */
const PAGE_SIZE = 100;

/** How many blocks sit directly in a page's body, a page of 100 at a time. */
const topLevelBlocks = async (api: NotionPort, id: string): Promise<number> => {
  let count = 0;
  let cursor: string | undefined;
  do {
    const listed = await api.listBlockChildren(id, PAGE_SIZE, cursor);
    count += listed.results.length;
    cursor = listed.has_more ? (listed.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return count;
};

/**
 * The whole body, replaced. The page is named by an id a model copied, and the
 * change cannot be undone through the API, so the answer says which page it
 * was (its title) and how many blocks its body held before and after: a wrong
 * page, or a body that shrank to nothing, shows at once.
 */
export const replaceContent = async (deps: Deps, args: Target & { readonly markdown: string; readonly allowDeleting: boolean; readonly clear: boolean }) => {
  const edit = replaceEdit(args.markdown, args.allowDeleting, args.clear);
  const id = toId(args.page, "page");
  const found = await deps.locator.find(id, ["page"], args.account);
  const api = deps.accounts.api(found.account);
  const blocksBefore = await topLevelBlocks(api, id);
  const after = await api.editContent(id, edit);
  return {
    account: found.account,
    id,
    title: pageTitle(found.page.properties),
    blocksBefore,
    blocksAfter: await topLevelBlocks(api, id),
    characters: after.markdown.length,
    ...(after.truncated ? { contentTruncated: true } : {}),
  };
};
