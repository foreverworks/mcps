import { hostnameProblem, normalHostname } from "../../domain/dns/hostname.js";
import { fail, inputError } from "../../domain/errors.js";
import { annotated, callTool } from "../callTool.js";
import type { Deps, ToolArgs } from "../ports.js";

/**
 * update_nameservers, with each name checked for syntax first (a typo here
 * takes the whole domain off the internet once the registry publishes it) and
 * the answer saying what the delegation was and what it becomes, so a list
 * that replaced the wrong set reads as one.
 */

/** The nameservers in Porkbun's answer to get_nameservers (`ns`), or null when it has no such list. */
const nameserversIn = (answer: unknown): readonly string[] | null => {
  const ns = typeof answer === "object" && answer !== null ? (answer as { readonly ns?: unknown }).ns : undefined;
  return Array.isArray(ns) && ns.every((n) => typeof n === "string") ? ns.map(normalHostname) : null;
};

export const updateNameservers = async (deps: Deps, args: ToolArgs & { readonly domain: string; readonly nameservers: readonly string[] }, revealsSecrets: boolean) => {
  const problems = args.nameservers.map(hostnameProblem).filter((p): p is string => p !== undefined);
  if (problems.length > 0) return fail(inputError(`nameservers: ${problems.join("; ")}; nothing was sent`));
  const after = args.nameservers.map(normalHostname);
  const twice = after.find((name, i) => after.indexOf(name) !== i);
  if (twice !== undefined) return fail(inputError(`nameservers: ${twice} is listed twice; nothing was sent`));
  const before = nameserversIn(await callTool(deps, "get_nameservers", { domain: args.domain }, revealsSecrets));
  const result = await callTool(deps, "update_nameservers", { ...args, nameservers: after }, revealsSecrets);
  return annotated(result, { nameservers: { before, after } });
};
