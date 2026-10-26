import type { Deps } from "../ports.js";

export type TemplateArgs = { readonly template: string; readonly variables?: Readonly<Record<string, unknown>> | undefined };

/** A Jinja template rendered by Home Assistant itself, with its states, areas and helpers. */
export const renderTemplate = async (deps: Deps, a: TemplateArgs) => ({ result: await deps.ha.renderTemplate(a.template, a.variables) });
