import { fail, inputError } from "./errors.js";
import { parseId } from "./ids.js";

/**
 * Which of a database's templates a new row starts from: its default, or one
 * named by id or by name. Checked against the database's own catalog before
 * the page is made, so a template from another database, or one that does not
 * exist, is refused with the ones that do.
 */
export type Template = { readonly id: string; readonly name: string; readonly isDefault: boolean };

/** What Notion is asked to apply: the database's default, or one template by id. */
export type TemplateChoice = { readonly type: "default" } | { readonly type: "template_id"; readonly id: string };

const listed = (templates: readonly Template[]): string =>
  templates.length === 0 ? "it has none" : `its templates are ${templates.map((t) => `"${t.name}"${t.isDefault ? " (the default)" : ""}`).join(", ")}`;

export const pickTemplate = (templates: readonly Template[], wanted: string): { readonly choice: TemplateChoice; readonly template: Template } => {
  const w = wanted.trim();
  if (w.toLowerCase() === "default") {
    const found = templates.find((t) => t.isDefault);
    return found === undefined
      ? fail(inputError(`this database has no default template; ${listed(templates)}`))
      : { choice: { type: "default" }, template: found };
  }
  const id = parseId(w);
  const byName = templates.filter((t) => t.name === w);
  const folded = templates.filter((t) => t.name.toLowerCase() === w.toLowerCase());
  const found =
    (id === undefined ? undefined : templates.find((t) => t.id === id)) ?? (byName.length === 1 ? byName[0] : undefined) ?? (folded.length === 1 ? folded[0] : undefined);
  if (found !== undefined) return { choice: { type: "template_id", id: found.id }, template: found };
  if (byName.length > 1 || folded.length > 1) return fail(inputError(`two templates are named "${w}"; give the id from list_database_templates`));
  return fail(inputError(`no template "${w}" in this database; ${listed(templates)}`));
};
