import { KNOWN_TOOLS } from "../../domain/tools.js";
import { fail, inputError } from "../../domain/errors.js";
import type { Deps, UpstreamResult } from "../ports.js";

/** A call to one of Granola's tools, answered as Granola answered it. */
export const callGranola = async (deps: Deps, name: string, args: Readonly<Record<string, unknown>>): Promise<UpstreamResult> => {
  if (!(KNOWN_TOOLS as readonly string[]).includes(name)) return fail(inputError(`${name} is not a tool this server offers`));
  return deps.upstream.callTool(name, args);
};
