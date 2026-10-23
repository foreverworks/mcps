import { portalInstant } from "../../domain/dates.js";
import { drift, fail } from "../../domain/errors.js";
import type { MessageRow } from "../../domain/messages.js";
import { attribute, decodeEntities, element, inputValue, options, tags, tagWith, visibleLines, visibleText } from "./html.js";

/**
 * SPV's pages as this server reads them. Pure; the
 * addresses and field names are here and in portal.ts only.
 */

// ---- the F5 sign-in form (/my.policy) ------------------------------------------------------------

export const SIGN_IN_PATH = "/my.policy";

/**
 * Which step of the sign-in a page is. Step one has `username` and
 * `password`; step two keeps only `password`, which takes the e-mailed code,
 * under the words "codul de siguranță".
 */
export const signInStage = (html: string): "password" | "code" | "other" => {
  if (tagWith(html, "input", "name", "username") !== undefined) return "password";
  if (tagWith(html, "input", "name", "password") !== undefined && /codul de siguran/i.test(visibleText(html))) return "code";
  return "other";
};

const BOILERPLATE = [/Javascript nu este activat\.?/gi, /Pentru deschiderea unei sesiuni noi va rugam apasati aici\.?/gi, /pfinternet\.anaf\.ro/gi, /Autentificare$/gi];

/** What SPV says on a sign-in page that refused something: its visible words, without the form's fixed text. */
export const signInMessage = (html: string): string => {
  const text = BOILERPLATE.reduce((t, re) => t.replace(re, " "), visibleText(html))
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 0 ? text.slice(0, 400) : "SPV showed the sign-in form again without a message";
};

// ---- the message list (/SNMD/index.xhtml) ----------------------------------------------------------

export const MESSAGES_PATH = "/SNMD/index.xhtml";
export const MESSAGES_FORM = "form";
export const MESSAGES_TABLE = "form:MesajeTable";
export const TYPE_FILTER = "form:MesajeTable:tipDocument:filter";

export const viewStateIn = (html: string): string => inputValue(html, "javax.faces.ViewState") ?? fail(drift("the page carries no javax.faces.ViewState"));

/** The rows PrimeFaces says the table has (`rowCount` in its widget's options), to check a listing is whole. */
export const rowCountIn = (html: string): number | undefined => {
  const m = /PrimeFaces\.cw\('DataTable',\s*'[^']*',\s*\{id:'form:MesajeTable'[^}]*?rowCount:(\d+)/.exec(html);
  return m?.[1] === undefined ? undefined : Number(m[1]);
};

/** A JSF partial response: each `<update id>`'s content. */
export const partialUpdates = (xml: string): ReadonlyMap<string, string> =>
  new Map([...xml.matchAll(/<update id="([^"]+)"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/g)].map((m) => [m[1] ?? "", m[2] ?? ""]));

/** A row and the id of its download link, which is the row's position in the view that rendered it. */
export type ListedRow = MessageRow & { readonly link: string };

const CELL = /<td\b[^>]*>([\s\S]*?)<\/td>/gi;
const LINK = /submitForm\('form','(form:MesajeTable:\d+:[^']+)'/;

const cellText = (cell: string): string => decodeEntities(cell.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/**
 * The table's rows. Seven cells, in SPV's order: CIF, document type, request
 * id, posted (dd.mm.yyyy hh:mm:ss), the PDF link, details, archived on.
 * A row that does not read that way is drift, never a skipped row.
 */
export const rowsIn = (fragment: string): readonly ListedRow[] =>
  [...fragment.matchAll(/<tr\b[^>]*data-ri="\d+"[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => {
    const cells = [...(m[1] ?? "").matchAll(CELL)].map((c) => c[1] ?? "");
    if (cells.length < 7) fail(drift(`a message row has ${cells.length} cells, not 7`));
    const [cif = "", type = "", requestId = "", posted = "", link = "", details = "", archived = ""] = cells;
    const linkId = LINK.exec(link)?.[1] ?? fail(drift("a message row has no download link"));
    const postedAtMs = portalInstant(cellText(posted)) ?? fail(drift(`a message row's date "${cellText(posted)}" is not dd.mm.yyyy hh:mm:ss`));
    const request = cellText(requestId);
    return {
      cif: cellText(cif),
      type: cellText(type),
      requestId: request === "" ? undefined : request,
      postedAtMs,
      archivedAtMs: portalInstant(cellText(archived)),
      details: cellText(details),
      link: linkId,
    };
  });

/** The name SPV gives a download (`attachment;filename="SV00000000001.pdf"`). */
export const servedFileName = (headers: Headers): string | undefined => {
  const disposition = headers.get("content-disposition") ?? "";
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition)?.[1];
  if (star !== undefined) return decodeURIComponent(star.trim().replace(/^"|"$/g, ""));
  return /filename\s*=\s*"?([^";]+)"?/i.exec(disposition)?.[1]?.trim();
};

// ---- the request form (/SNMD/solicitari.xhtml) -------------------------------------------------------

export const REQUESTS_PATH = "/SNMD/solicitari.xhtml";

export type RequestFormPage = {
  readonly identities: readonly string[];
  readonly personTypes: readonly string[];
  readonly companyTypes: readonly string[];
  /** The submit button's generated name, which the post must carry. */
  readonly submitName: string;
  readonly viewState: string;
};

const listIn = (html: string, id: string): readonly string[] | undefined => {
  const tag = tagWith(html, "input", "id", id);
  const value = tag === undefined ? undefined : attribute(tag, "value");
  return value === undefined ? undefined : value.split(";").map((t) => t.trim()).filter((t) => t.length > 0);
};

/**
 * The form's identities (`form1:cui`) and its type lists. The page's script
 * fills the type select from two hidden lists, `PF` for a person and `PJ`
 * for a company; an account without a company has no `PJ`.
 */
export const requestFormIn = (html: string): RequestFormPage => {
  const form = element(html, "form", "id", "form1") ?? fail(drift("the request page has no form1"));
  const cui = element(form, "select", "name", "form1:cui") ?? fail(drift("the request form has no form1:cui"));
  const typeSelect = element(form, "select", "name", "form1:TipDocument");
  const submit = tags(form, "input").find((t) => attribute(t, "type") === "submit") ?? fail(drift("the request form has no submit button"));
  const fallback = typeSelect === undefined ? [] : options(typeSelect).map((o) => o.value);
  return {
    identities: options(cui).map((o) => o.value),
    personTypes: listIn(html, "PF") ?? fallback,
    companyTypes: listIn(html, "PJ") ?? [],
    submitName: attribute(submit, "name") ?? fail(drift("the request form's submit button has no name")),
    viewState: viewStateIn(form),
  };
};

/** The id SPV registered a request under: "Solicitarea a fost inregistrata cu id=192000123". */
export const requestIdIn = (html: string): string | undefined => /[iî]nregistrat[aă]\s+cu\s+id\s*=\s*(\d+)/i.exec(visibleText(html))?.[1];

/** What a page says that another rendering of it did not: the message a form post added. */
export const addedLines = (before: string, after: string): readonly string[] => {
  const seen = new Set(visibleLines(before));
  return visibleLines(after).filter((line) => !seen.has(line));
};
