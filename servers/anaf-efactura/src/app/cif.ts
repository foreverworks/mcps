import { normaliseCif } from "../domain/cif.js";
import { configError, fail } from "../domain/errors.js";
import type { Deps } from "./ports.js";

/**
 * Which company a call is about.
 *
 * The CIF is deployment data, not a constant: it identifies whoever's grant the
 * tokens belong to, so it lives in app.json beside the client id rather than in
 * this source tree. An explicit argument still wins, because one grant can be
 * authorised for several CIFs.
 */
export const resolveCif = async (deps: Deps, provided: string): Promise<string> => {
  if (provided !== "") return normaliseCif(provided);
  const { defaultCif } = await deps.identity();
  if (defaultCif === undefined || defaultCif === "")
    fail(configError(`no cif argument, and app.json declares no company_cif to fall back on`));
  return normaliseCif(String(defaultCif));
};
