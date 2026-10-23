import { compact } from "@foreverworks/mcp-kit";

import { chooseAccounts } from "../../domain/accounts.js";
import { describeThrown } from "../../domain/errors.js";
import type { RawUser } from "../../domain/schema.js";
import type { Deps } from "../ports.js";

/** The workspaces, from the token files alone: no request to Notion. */
export const listAccounts = async (deps: Deps) => ({
  accounts: await deps.accounts.labels(),
  tokens: deps.accounts.source ?? null,
});

const workspaceOf = (me: RawUser): string | undefined => {
  if (me.type !== "bot") return undefined;
  const bot = me.bot as { readonly workspace_name?: string | null };
  return bot.workspace_name ?? undefined;
};

/** What one workspace answers when asked who its integration is and whether it sees anything. */
export type Probe = { readonly workspace?: string; readonly integration?: string; readonly seesContent: boolean };

/** One workspace, asked. Throws the workspace's failure; the callers decide how to say it. */
export const probeAccount = async (deps: Deps, label: string): Promise<Probe> => {
  const api = deps.accounts.api(label);
  const [me, some] = await Promise.all([api.me(), api.search({ pageSize: 1 })]);
  return { ...compact({ workspace: workspaceOf(me), integration: me.name ?? undefined }), seesContent: some.results.length > 0 };
};

/** Said when an integration sees nothing: not an error to Notion (search answers an empty list), but useless until fixed. */
export const NOTHING_SHARED = "the integration sees no page yet: share the workspace's top-level pages with it (••• > Connections)";

export type AccountHealth =
  | ({ readonly account: string; readonly ok: true; readonly hint?: string } & Probe)
  | { readonly account: string; readonly ok: false; readonly error: string };

/**
 * Each workspace, asked: who the integration is, and whether it sees anything
 * at all. One broken workspace never hides the others' answers.
 */
export const checkHealth = async (deps: Deps, account?: string) => {
  const labels = chooseAccounts(account, await deps.accounts.labels());
  const accounts = await Promise.all(
    labels.map(async (label): Promise<AccountHealth> => {
      try {
        const probe = await probeAccount(deps, label);
        return { account: label, ok: true, ...probe, ...(probe.seesContent ? {} : { hint: NOTHING_SHARED }) };
      } catch (thrown) {
        return { account: label, ok: false, error: describeThrown(thrown) };
      }
    }),
  );
  return { allOk: accounts.every((a) => a.ok), accounts };
};
