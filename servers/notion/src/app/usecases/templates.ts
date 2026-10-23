import { fail, inputError } from "../../domain/errors.js";
import type { Template } from "../../domain/templates.js";
import type { NotionPort } from "../ports.js";

/** Every template of a data source, every page of its catalog. */
export const templatesOf = async (api: NotionPort, dataSourceId: string): Promise<readonly Template[]> => {
  const out: Template[] = [];
  let cursor: string | undefined;
  do {
    const page = await api.listTemplates(dataSourceId, 100, cursor);
    out.push(...page.templates.map((t) => ({ id: t.id, name: t.name, isDefault: t.is_default })));
    if (page.has_more && !page.next_cursor) return fail(inputError("the template catalog is incomplete; refusing to pick a template without seeing all of them"));
    cursor = page.has_more ? (page.next_cursor ?? undefined) : undefined;
  } while (cursor !== undefined);
  return out;
};
