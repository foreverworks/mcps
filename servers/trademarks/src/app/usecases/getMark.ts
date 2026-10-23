import { UNCOVERED } from "../../domain/coverage.js";
import { fail } from "../../domain/errors.js";
import type { Office } from "../../domain/mark.js";
import type { Deps } from "../ports.js";

/** One mark's details from its office. */
export const getMark = async (deps: Deps, office: Office, id: string) => {
  const register = deps.registers.find((r) => r.office === office);
  if (register === undefined) return fail({ kind: "unsupported", message: `${office} ${UNCOVERED[office] ?? "not searched: no source for it is enabled on this server"}` });
  return { source: register.source, ...(await register.get(id)) };
};
