import { memoize } from "@foreverworks/mcp-kit";

import type { NomenclatureCache, OblioPort } from "./ports.js";

/**
 * The three lists that change rarely (companies, series, VAT rates), on the
 * kit's keyed memo: remembered for a while, one request shared by everyone who
 * asks while it runs, a failure not remembered. Documents and clients are
 * never cached.
 *
 * Why these three, by what they cost: every issue starts by reading them
 * (which series, which VAT name), each read spends one of the 30 requests per
 * 10 seconds Oblio allows, and their content changes only when a human edits
 * the company's settings. A series' `next` number is the exception, since it
 * moves with every document, so the series are forgotten after anything this
 * server issues or deletes, and every answer carries `asOf`.
 */
export const makeNomenclatureCache = (oblio: OblioPort, ttlMs: number, now: () => number): NomenclatureCache => {
  const stamped = <K, T>(load: (key: K) => Promise<T>) =>
    memoize(
      ttlMs,
      async (key: K) => {
        const asOf = now();
        return { value: await load(key), asOf };
      },
      now,
    );

  const companies = stamped((_: "all") => oblio.listCompanies());
  const vatRates = stamped((cif: string) => oblio.listVatRates({ cif }));
  const freshSeries = () => stamped((cif: string) => oblio.listSeries({ cif }));
  let series = freshSeries();

  return {
    companies: () => companies("all"),
    series: (cif) => series(cif),
    vatRates: (cif) => vatRates(cif),
    forgetSeries: () => {
      series = freshSeries();
    },
  };
};

/** Ten minutes: long enough to cover a session's burst of issues, short enough for a settings edit. */
export const NOMENCLATURE_TTL_MS = 10 * 60 * 1000;
