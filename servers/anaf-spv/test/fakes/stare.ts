/**
 * A fake of ANAF's public status service (StareD112): the listing of a tax
 * id's filings in the page's own shape and encoding (ISO-8859-1 with
 * entities), "Nu a fost identificata", the refusal of an index that is not
 * digits, and receipts that answer an empty body once ANAF no longer serves
 * them. Invented filings only.
 */
import { readFileSync } from "node:fs";

export const STARE_ORIGIN = "https://stare.anaf.ro";

export type FakeFiling = {
  readonly index: string;
  readonly cif: string;
  readonly form: string;
  readonly state: string;
  /** DD.MM.YYYY */
  readonly registeredOn: string;
  /** The receipt's bytes; none once the 60 days are over. */
  readonly receipt?: Uint8Array;
};

const fixture = (name: string) => readFileSync(new URL(`../fixtures/stare/${name}`, import.meta.url));

const listing = (cif: string, filings: readonly FakeFiling[]) =>
  `<table border="0" width="100%" cellspacing="0"><tr><td valign="top">\nDocumente depuse pentru cui: ${cif} in perioada 22.07.2026 / 22.10.2026 \n <br>\n` +
  `<table border="1" align="center" bgcolor="#fffff0" width="100%">\n<thead>\n<td>Index</td><td>Tip document</td><td>Stare document</td><td>Data inregistrare</td><td> Consulta&#355;i</td><td>Data incarcare</td>\n</thead>\n` +
  filings
    .map((f) => {
      const [d, m, y] = f.registeredOn.split(".");
      const link = f.receipt === undefined ? "" : `<a href="/StareD112/ObtineRecipisa?numefisier=${f.index}.pdf"><b>recipisa</b></a>`;
      return `  <tr align="left">\n  <td>${f.index}</td>\n <td>\n ${f.form}\n </td>\n <td>${f.state}<br>\n </td>\n <td>INTERNT-${f.index}-${y} din ${f.registeredOn}</td>\n <td>\n ${link}\n <br>\n </td>\n <td>\n ${y}-${m}-${d}\n </td>\n </tr>\n`;
    })
    .join("") +
  "</table></td></tr></table>";

export const makeFakeStare = (filings: FakeFiling[] = []) => {
  const state = { lookups: [] as { readonly id: string; readonly cui: string; readonly ghiseu: string }[], receipts: [] as string[] };
  const page = (body: string | Uint8Array) => new Response(typeof body === "string" ? Buffer.from(body, "latin1") : body, { status: 200, headers: { "content-type": "text/html;charset=ISO-8859-1" } });
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/StareD112/vizualizareStare.do" && (init?.method ?? "GET").toUpperCase() === "POST") {
      const form = new URLSearchParams(String(init?.body ?? ""));
      const query = { id: form.get("id") ?? "", cui: form.get("cui") ?? "", ghiseu: form.get("ghiseu") ?? "" };
      state.lookups.push(query);
      if (!/^\d+$/.test(query.id)) return page(fixture("refused.html"));
      const own = filings.filter((f) => f.cif === query.cui);
      return own.some((f) => f.index === query.id) ? page(listing(query.cui, own)) : page(fixture("none.html"));
    }
    if (url.pathname === "/StareD112/ObtineRecipisa") {
      const index = (url.searchParams.get("numefisier") ?? "").replace(/\.pdf$/, "");
      state.receipts.push(index);
      const bytes = filings.find((f) => f.index === index)?.receipt ?? new Uint8Array();
      return new Response(bytes, { status: 200, headers: { "content-type": "application/pdf", "content-disposition": `inline;filename=${index}.pdf` } });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetch: fetch as typeof globalThis.fetch, state, filings };
};
