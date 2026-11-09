import { run } from "@foreverworks/mcp-kit";

import { fail, hostError } from "../domain/errors.js";

/**
 * One command on the broker's own machine, as an argv with no shell, as the broker's own user: what a host
 * with no ssh target runs its control command through. Failures read as ssh's do: a non-zero exit is a host
 * error carrying the last lines of what the command said.
 */
export const makeLocal =
  () =>
  async (argv: readonly [string, ...string[]], timeoutMs = 60_000): Promise<string> => {
    const r = await run(argv, { timeoutMs });
    if (r.code !== 0) return fail(hostError(argv[0], `exit ${r.code}: ${(r.stderr || r.stdout).trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`));
    return r.stdout;
  };

export type Local = ReturnType<typeof makeLocal>;
