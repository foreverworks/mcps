import type { EnableBankingPort } from "../app/ports.js";
import { apiError, fail } from "../domain/errors.js";
import type {
  AuthorizeSessionRequest,
  RawAccount,
  RawApplication,
  RawAspspList,
  RawAuthorizedSession,
  RawBalance,
  RawBalancePage,
  RawSession,
  RawStartedAuthorization,
  RawTransaction,
  RawTransactionPage,
  StartAuthorizationRequest,
} from "../domain/schema.js";
import type { Request } from "./http.js";

/**
 * Transactions arrive a page at a time, keyed by an opaque `continuation_key`.
 *
 * The cap and the repeat check are both here because the walk is driven
 * entirely by a value the server chooses. A bank that returns the same key
 * twice, or never stops returning one, would otherwise spin until the process
 * is killed, and a hung tool is harder to diagnose than a refusal.
 */
const MAX_PAGES = 200;

const account = (uid: string): string => `/accounts/${encodeURIComponent(uid)}`;

/**
 * The only module that knows Enable Banking's paths and parameter names
 * (https://enablebanking.com/docs/api/reference/). Each body sent is typed by
 * the spec's own request schema, so a renamed field fails the build.
 */
export const makeBankApi = (request: Request, redirectUrl: () => Promise<string>): EnableBankingPort => ({
  application: () => request<RawApplication>({ method: "GET", path: "/application" }),

  listAspsps: async (country) => {
    const data = await request<RawAspspList>({
      method: "GET",
      path: "/aspsps",
      ...(country === undefined ? {} : { query: { country } }),
    });
    return data.aspsps;
  },

  startAuth: async (r) => {
    // `access.accounts` is left out on purpose: that is how every account is
    // asked for, and the bank's own consent screen lets the person tick them.
    // balances and transactions default to true, which is what is wanted and
    // what the calls that have worked in production never sent explicitly.
    const body: StartAuthorizationRequest = {
      access: { valid_until: r.validUntil },
      aspsp: { name: r.aspspName, country: r.aspspCountry },
      psu_type: r.psuType,
      redirect_url: await redirectUrl(),
      state: r.state,
    };
    return request<RawStartedAuthorization>({ method: "POST", path: "/auth", body });
  },

  authorizeSession: (code) => {
    const body: AuthorizeSessionRequest = { code };
    return request<RawAuthorizedSession>({ method: "POST", path: "/sessions", body });
  },

  getSession: (sessionId) => request<RawSession>({ method: "GET", path: `/sessions/${encodeURIComponent(sessionId)}` }),

  deleteSession: async (sessionId) => {
    await request<unknown>({ method: "DELETE", path: `/sessions/${encodeURIComponent(sessionId)}` });
  },

  accountDetails: (uid) => request<RawAccount>({ method: "GET", path: `${account(uid)}/details` }),

  getBalances: async (uid): Promise<readonly RawBalance[]> => {
    const data = await request<RawBalancePage>({ method: "GET", path: `${account(uid)}/balances` });
    return data.balances;
  },

  getTransactions: async ({ accountUid, from, to, status }) => {
    const path = `${account(accountUid)}/transactions`;
    const base = {
      ...(status === undefined ? {} : { transaction_status: status }),
      ...(from === undefined ? {} : { date_from: from }),
      ...(to === undefined ? {} : { date_to: to }),
    };

    let rows: readonly RawTransaction[] = [];
    let seen: ReadonlySet<string> = new Set();
    let continuation: string | undefined;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const data = await request<RawTransactionPage>({
        method: "GET",
        path,
        query: { ...base, ...(continuation === undefined ? {} : { continuation_key: continuation }) },
      });
      rows = [...rows, ...data.transactions];
      // Absent, null and empty all mean the same thing: there is no next page.
      const next = data.continuation_key ?? "";
      if (next === "") return rows;
      if (seen.has(next)) return fail(apiError(200, `${path} repeated continuation key ${next}; stopped after ${rows.length} rows`));
      seen = new Set([...seen, next]);
      continuation = next;
    }
    return fail(apiError(200, `${path} did not stop paginating after ${MAX_PAGES} pages (${rows.length} rows)`));
  },
});
