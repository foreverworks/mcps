import type { Deps, ToolArgs } from "./ports.js";

/**
 * Run one of Porkbun's tools. A secret leaves this server only in the result
 * of a tool that `revealsSecrets` (the `money` class, which a client asks its
 * user to approve): every other result has its secret fields withheld.
 */
export const callTool = async ({ porkbun }: Deps, name: string, args: ToolArgs, revealsSecrets: boolean): Promise<unknown> => {
  const result = await porkbun.run(name, args);
  return revealsSecrets ? result : porkbun.withholdSecrets(result);
};

/** Porkbun's answer with this server's fields added: beside Porkbun's own when it answered an object, else around it. */
export const annotated = (result: unknown, extra: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> =>
  typeof result === "object" && result !== null && !Array.isArray(result) ? { ...result, ...extra } : { result, ...extra };
