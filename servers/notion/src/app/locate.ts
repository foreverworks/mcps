import { chooseAccounts } from "../domain/accounts.js";
import { asAppError, fail } from "../domain/errors.js";
import type { RawBlockAnswer, RawDatabase, RawDataSource, RawPage, RawView } from "../domain/schema.js";
import type { Accounts } from "./ports.js";

/**
 * Which workspace an id lives in, found by asking, so no tool needs `account`.
 *
 * A Notion id exists in exactly one workspace, and the only way to learn which
 * is to ask each: a 404 from one while another answers is not a failure. A
 * database, a data source, a page and a block are fetched from different
 * endpoints, and the id alone does not say which it is either, so the same loop
 * asks each kind the caller accepts (a page is also a block, so asking for a
 * block finds a page as well); Notion answers a kind mismatch with a 404 or a 400
 * `validation_error`, and both mean "not here, not this".
 *
 * What was found is remembered for the life of the process (per id: its
 * workspace and its kind), so the search costs its misses once. Ids learned
 * from answers (search hits, query rows, a page just created) are remembered
 * too, which makes the first call on them free.
 */

export type ObjectKind = "page" | "database" | "data_source" | "block" | "view";

export type Found =
  | { readonly kind: "page"; readonly account: string; readonly page: RawPage }
  | { readonly kind: "database"; readonly account: string; readonly database: RawDatabase }
  | { readonly kind: "data_source"; readonly account: string; readonly source: RawDataSource }
  | { readonly kind: "block"; readonly account: string; readonly block: RawBlockAnswer }
  | { readonly kind: "view"; readonly account: string; readonly view: RawView };

export type Locator = {
  /** The object `id` names, as one of `kinds`, from the workspace that has it (or from `account` alone). */
  readonly find: <K extends ObjectKind>(id: string, kinds: readonly K[], account?: string) => Promise<Extract<Found, { readonly kind: K }>>;
  /** Only which workspace has it: no request at all when this process has seen the id. */
  readonly accountOf: (id: string, kinds: readonly ObjectKind[], account?: string) => Promise<string>;
  /** An id an answer revealed, with its workspace and kind. */
  readonly learn: (id: string, account: string, kind: ObjectKind) => void;
};

/** How many ids to remember before the oldest are forgotten. */
const MEMORY = 20_000;

/** "Not here, or not this kind": the answers that send the search on to the next place. */
const isMiss = (thrown: unknown): boolean => {
  const error = asAppError(thrown);
  return error?.kind === "not_shared" || (error?.kind === "input" && error.code === "validation_error");
};

export const makeLocator = (accounts: Accounts): Locator => {
  const known = new Map<string, { readonly account: string; readonly kind: ObjectKind }>();

  const learn = (id: string, account: string, kind: ObjectKind): void => {
    known.delete(id);
    known.set(id, { account, kind });
    if (known.size > MEMORY) known.delete(known.keys().next().value as string);
  };

  const probe = async (account: string, kind: ObjectKind, id: string): Promise<Found> => {
    const api = accounts.api(account);
    switch (kind) {
      case "page":
        return { kind, account, page: await api.getPage(id) };
      case "database": {
        const database = await api.getDatabase(id);
        for (const source of database.data_sources) learn(source.id, account, "data_source");
        return { kind, account, database };
      }
      case "data_source": {
        const source = await api.getDataSource(id);
        const parent = source.parent as { readonly database_id?: string };
        if (parent.database_id !== undefined) learn(parent.database_id, account, "database");
        return { kind, account, source };
      }
      case "block":
        return { kind, account, block: await api.getBlock(id) };
      case "view":
        return { kind, account, view: await api.getView(id) };
    }
  };

  const find = async <K extends ObjectKind>(id: string, kinds: readonly K[], requested?: string): Promise<Extract<Found, { readonly kind: K }>> => {
    const labels = chooseAccounts(requested, await accounts.labels());
    const hint = known.get(id);
    const order = hint !== undefined && labels.includes(hint.account) ? [hint.account, ...labels.filter((l) => l !== hint.account)] : labels;
    const asked: readonly ObjectKind[] = kinds;
    for (const account of order) {
      const kindOrder = hint?.account === account && asked.includes(hint.kind) ? [hint.kind, ...asked.filter((k) => k !== hint.kind)] : asked;
      for (const kind of kindOrder) {
        try {
          const found = await probe(account, kind, id);
          learn(id, account, kind);
          // probe answers the kind it was asked for, which is one of K.
          return found as Extract<Found, { readonly kind: K }>;
        } catch (thrown) {
          if (!isMiss(thrown)) throw thrown;
        }
      }
    }
    known.delete(id);
    const what = kinds.map((k) => k.replace("_", " ")).join(" or ");
    return fail({ kind: "not_shared", id, accounts: order, message: `no ${what} ${id} in ${order.map((a) => `"${a}"`).join(" or ")}` });
  };

  const accountOf = async (id: string, kinds: readonly ObjectKind[], requested?: string): Promise<string> => {
    const hint = known.get(id);
    if (hint !== undefined && kinds.includes(hint.kind) && (requested === undefined || requested === "*" || requested === hint.account)) return hint.account;
    return (await find(id, kinds, requested)).account;
  };

  return { find, accountOf, learn };
};
