import { missingScopes } from "../domain/grants.js";
import { asAppError, describeThrown, isServiceDisabled } from "../domain/errors.js";
import { EDITOR_APIS, type EditorApi, type HealthDeps } from "./ports.js";

export type ApiState = "enabled" | "disabled" | string;

export type Health = {
  readonly ok: boolean;
  readonly source: "drive" | "credentials";
  readonly detail: string;
  readonly address: string;
  readonly addressMatches: boolean | null;
  readonly scopes: readonly string[];
  readonly missingScopes: readonly string[];
  readonly apis: Readonly<Record<EditorApi, ApiState>>;
};

const stateOf = async (deps: HealthDeps, api: EditorApi): Promise<ApiState> => {
  try {
    await deps.probe(api);
    return "enabled";
  } catch (thrown) {
    const error = asAppError(thrown);
    // Disabled is the answer an operator can act on (one click in the console), so it is named, not described.
    if (error?.kind === "api" && isServiceDisabled(error.reason)) return "disabled";
    return describeThrown(thrown);
  }
};

/**
 * Alive, as whom, with what, and whether each API answers.
 *
 * The last is the one only this check can see: a grant that already works
 * for Drive may still be refused by Docs, Sheets and Slides, three more APIs
 * its client's Cloud project has to enable, and until it does every call to
 * them fails with a 403 that reads like a permission problem.
 */
export const checkHealth = async (deps: HealthDeps): Promise<Health> => {
  const scopes = await deps.scopes();
  const address = await deps.whoami();
  const entries = await Promise.all(EDITOR_APIS.map(async (api) => [api, await stateOf(deps, api)] as const));
  const apis = Object.fromEntries(entries) as Record<EditorApi, ApiState>;
  const missing = missingScopes(scopes);
  const addressMatches = deps.address === undefined ? null : deps.address.toLowerCase() === address.toLowerCase();
  return {
    ok: missing.length === 0 && addressMatches !== false && entries.every(([, state]) => state === "enabled"),
    source: deps.source,
    detail: deps.detail,
    address,
    addressMatches,
    scopes,
    missingScopes: missing,
    apis,
  };
};
