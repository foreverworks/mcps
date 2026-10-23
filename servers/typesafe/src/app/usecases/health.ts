import type { Deps } from "../ports.js";

/**
 * Is the key there and accepted, and what can it reach: the models list is
 * an authenticated read that costs nothing, so a revoked key fails HERE with
 * its remedy rather than later in the middle of a batch.
 */
export const checkHealth = async (deps: Deps) => {
  const models = await deps.systemOne.models();
  return {
    ok: true,
    api: deps.baseUrl,
    defaultModel: deps.defaultModel,
    models: models.map((m) => ({ name: m.name, released: m.release_date })),
  };
};
