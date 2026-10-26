import type { Deps } from "../ports.js";
import { requireAdminFor } from "./admin.js";

export type TemplateArgs = { readonly template: string; readonly variables?: Readonly<Record<string, unknown>> | undefined };

/** A Jinja template rendered by Home Assistant itself, with its states, areas and helpers; an administrator's token only. */
export const renderTemplate = async (deps: Deps, a: TemplateArgs) => {
  await requireAdminFor(deps, "render_template");
  return { result: await deps.ha.renderTemplate(a.template, a.variables) };
};
