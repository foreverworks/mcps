import type { HttpRequest } from "@foreverworks/mcp-kit";

import type { StareAnswer, StarePort, StareRow } from "../app/ports.js";
import { drift, fail } from "../domain/errors.js";
import { folded } from "../domain/messages.js";
import { visibleText } from "./portal/html.js";

/**
 * ANAF's public status service for filed declarations, StareD112
 * (stare.anaf.ro/StareD112; www.anaf.ro/StareD112 resets the connection since
 * 2026), which ANAF's forms pages point every electronic filing to. No
 * sign-in, no captcha. Read 2026-10-22 against anafpy's captures
 * (docs/anaf-reference/declaratii/stared112.md) and two answers recorded with
 * an invented index and tax id:
 *
 *   POST /StareD112/vizualizareStare.do   ghiseu=N (filed online), id, cui
 *
 * answers ISO-8859-1 HTML in one of three shapes: "Documente depuse pentru
 * cui: <id> in perioada <from> / <to>" and a table (Index, Tip document,
 * Stare document, Data inregistrare, Consultaţi, Data incarcare) of that tax
 * id's filings of the last three months, at most 200; "Nu a fost identificata
 * nicio declaratie cu datele introduse"; or "Nu ati introdus un index valid".
 * A row's "recipisa" link is `ObtineRecipisa?numefisier=<index>.pdf`, kept 60
 * days after filing; past that, or for an unknown index, the same address
 * answers an empty body.
 */

const LATIN1 = new TextDecoder("latin1");

const cellsOf = (row: string): readonly string[] => [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1] ?? "");

/** One answer page, read. Pure. */
export const stareAnswerIn = (html: string): StareAnswer => {
  const text = visibleText(html);
  const listed = /Documente depuse pentru cui:\s*(\S+)\s+in perioada\s+(\d{2}\.\d{2}\.\d{4})\s*\/\s*(\d{2}\.\d{2}\.\d{4})/i.exec(text);
  if (listed !== null) {
    // The rows of the listing's own table, which sits inside a cell of the page's layout table.
    const table = /<\/thead>([\s\S]*?)<\/table>/i.exec(html)?.[1] ?? "";
    const rows: StareRow[] = [];
    for (const m of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = cellsOf(m[1] ?? "");
      const [index, document, state, registered, consult, uploaded] = cells.map((c) => visibleText(c));
      if (cells.length !== 6 || index === undefined || !/^\d+$/.test(index)) continue;
      rows.push({
        index,
        document: document ?? "",
        state: state ?? "",
        registered: registered ?? "",
        uploaded: uploaded ?? "",
        receiptLinked: /ObtineRecipisa\?numefisier=/i.test(cells[4] ?? "") && folded(consult ?? "").includes("recipisa"),
      });
    }
    return { kind: "rows", cif: listed[1] ?? "", from: listed[2] ?? "", to: listed[3] ?? "", rows };
  }
  if (/Nu a fost identificata nicio declaratie/i.test(text)) return { kind: "none" };
  const bad = /Nu ati introdus un [^.<]*?valid\w*/i.exec(text);
  if (bad !== null) return { kind: "refused", message: bad[0] };
  return fail(drift(`StareD112 answered a page this server does not know: "${text.slice(0, 200)}"`));
};

export const makeStare = (http: HttpRequest, base: string): StarePort => ({
  lookup: async ({ index, cif }) => {
    const page = await http<Uint8Array>(`${base}/vizualizareStare.do`, { method: "POST", form: { ghiseu: "N", id: index, cui: cif }, as: "bytes", idempotent: true });
    return stareAnswerIn(LATIN1.decode(page));
  },
  receipt: async (index) => {
    const bytes = await http<Uint8Array>(`${base}/ObtineRecipisa`, { query: { numefisier: `${index}.pdf` }, as: "bytes" });
    if (bytes.byteLength === 0) return undefined;
    if (LATIN1.decode(bytes.subarray(0, 5)) !== "%PDF-") fail(drift(`StareD112 answered the receipt of ${index} with something that is not a PDF (${bytes.byteLength} bytes)`));
    return bytes;
  },
});
