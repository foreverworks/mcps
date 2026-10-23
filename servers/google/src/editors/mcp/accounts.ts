import { ALL_ACCOUNTS } from "../../domain/accounts.js";
import { checkHealth } from "../app/health.js";
import type { Editors } from "../composition.js";
import { describeThrown, GRANT_REMEDY } from "../domain/errors.js";

/**
 * The `editors` section of list_accounts and health: the grants Docs, Sheets
 * and Slides share. The tools are the server's (src/mcp/accounts.ts).
 */
export const listAccounts = (editors: Editors) => {
  const specs = editors.specs();
  const first = editors.defaultLabel();
  return {
    products: ["docs", "sheets", "slides"],
    accounts: specs.map((spec) => ({
      account: spec.label,
      default: spec.label === first,
      source: spec.source,
      ...(spec.source === "credentials"
        ? { credentialsPath: spec.credentials, ...(spec.address ? { address: spec.address } : {}) }
        : { note: "runs on the Drive grant; see the drive section" }),
    })),
    root: editors.root,
    ...(specs.length === 0 ? { hint: `no account has a grant yet; ${GRANT_REMEDY}` } : {}),
  };
};

const checkOne = async (editors: Editors, label: string) => {
  try {
    return { account: label, ...(await checkHealth(editors.account(label).health)) };
  } catch (thrown) {
    return { account: label, ok: false, error: describeThrown(thrown) };
  }
};

export const health = async (editors: Editors, account: string) => {
  const labels = account.trim() === ALL_ACCOUNTS ? editors.specs().map((s) => s.label) : [account.trim() || editors.defaultLabel()];
  // One dead grant must not hide the verdict on the other.
  const accounts = await Promise.all(labels.map((label) => checkOne(editors, label)));
  return { accounts, allOk: accounts.every((a) => a.ok) };
};
