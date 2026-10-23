import type { Deps, Remembered } from "../ports.js";

/**
 * Every call is scoped to one company.
 *
 * The CIF is not a constant: an Oblio account can be attached to several
 * companies, and it decides whose invoices a call touches. It lives in app.json
 * rather than in this source tree for that reason, and because a company
 * identifier is deployment data.
 */
export const scope = async (deps: Deps): Promise<{ readonly cif: string }> => ({
  cif: (await deps.identity()).companyCif,
});

/** Oblio pages clients and products 250 at a time. */
export const PAGE_SIZE = 250;

const asOf = (r: Remembered<unknown>): string => new Date(r.asOf).toISOString();

export const checkHealth = async ({ oblio, identity, paths }: Deps) => {
  const app = await identity();
  // Live, never from the cache: a health check is about the credentials NOW.
  const companies = await oblio.listCompanies();
  return {
    ok: true,
    account: app.accountId,
    companyCif: app.companyCif,
    // Whether the configured CIF is one this account can actually act on is the
    // question a health check exists to answer, and it is one comparison away.
    companyReachable: companies.some((c) => c.cif === app.companyCif),
    configPath: paths.config,
    stateDir: paths.stateDir,
    companies,
  };
};

export const listCompanies = async (deps: Deps) => {
  const r = await deps.cache.companies();
  return { count: r.value.length, companies: r.value, asOf: asOf(r) };
};

export const listSeries = async (deps: Deps) => {
  const r = await deps.cache.series((await scope(deps)).cif);
  return { count: r.value.length, series: r.value, asOf: asOf(r) };
};

export const listVatRates = async (deps: Deps) => {
  const r = await deps.cache.vatRates((await scope(deps)).cif);
  return { count: r.value.length, vatRates: r.value, asOf: asOf(r) };
};

/**
 * One page, cut to `limit`. `nextOffset` is present only when Oblio returned a
 * full page, which is the only evidence it has more; `omitted` counts the rows
 * of this page that `limit` held back.
 */
const page = <T>(rows: readonly T[], offset: number, limit: number) => {
  const shown = rows.slice(0, limit);
  return {
    count: shown.length,
    rows: shown,
    ...(shown.length < rows.length ? { omitted: rows.length - shown.length } : {}),
    ...(rows.length >= PAGE_SIZE ? { nextOffset: offset + PAGE_SIZE } : {}),
  };
};

export type ListArgs = { readonly name?: string; readonly offset: number; readonly limit: number };

export const listClients = async (deps: Deps, args: ListArgs & { readonly clientCif?: string }) => {
  const rows = await deps.oblio.listClients({
    ...(await scope(deps)),
    offset: args.offset,
    ...(args.name === undefined ? {} : { name: args.name }),
    ...(args.clientCif === undefined ? {} : { clientCif: args.clientCif }),
  });
  const { rows: clients, ...rest } = page(rows, args.offset, args.limit);
  return { ...rest, clients };
};

export const listProducts = async (deps: Deps, args: ListArgs & { readonly code?: string }) => {
  const rows = await deps.oblio.listProducts({
    ...(await scope(deps)),
    offset: args.offset,
    ...(args.name === undefined ? {} : { name: args.name }),
    ...(args.code === undefined ? {} : { code: args.code }),
  });
  const { rows: products, ...rest } = page(rows, args.offset, args.limit);
  return { ...rest, products };
};
