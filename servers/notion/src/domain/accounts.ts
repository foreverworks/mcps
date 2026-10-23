import { configError, fail, inputError } from "./errors.js";

/**
 * The workspaces, by label: whatever names the token files carry
 * (`notion-<label>`, infra/tokens.ts). No label is known to this code.
 */

/** Every tool that reads across accounts takes this to mean "every account at once". */
export const ALL_ACCOUNTS = "*";

/**
 * What a label may be: lower-case letters, digits and hyphens. It names a file
 * (`notion-<label>`), so it can never hold a dot or a slash and walk out of the
 * tokens directory.
 */
export const LABEL = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The accounts one call covers. No `account` (or `*`) means all of them, in
 * the order given; a label means that one, and a label nobody configured is
 * the caller's mistake, answered with the ones that exist.
 */
export const chooseAccounts = (requested: string | undefined, available: readonly string[]): readonly string[] => {
  if (available.length === 0) return fail(configError("no Notion workspace is configured: there is no notion-<label> token file"));
  const wanted = requested?.trim() ?? "";
  if (wanted === "" || wanted === ALL_ACCOUNTS) return available;
  if (available.includes(wanted)) return [wanted];
  return fail(inputError(`no Notion account "${wanted}"; the accounts are ${available.map((a) => `"${a}"`).join(", ")}`));
};
