import type { ContactOutcome, Downloaded, LoginPort, PortalPort, RequestForm, SessionStore, Submitted } from "../../app/ports.js";
import { drift, fail } from "../../domain/errors.js";
import type { Cookies } from "../../domain/session.js";
import { type Browser, type Page, textOf } from "../browser.js";
import type { Exclusive } from "../store.js";
import { CONTACT_PATH, contactAnswerIn, contactFormIn, type ContactPage, identitiesIn } from "./contact.js";
import { type Go, makeCookieRunner } from "./cookies.js";
import {
  addedLines,
  MESSAGES_FORM,
  MESSAGES_PATH,
  MESSAGES_TABLE,
  partialUpdates,
  REQUESTS_PATH,
  requestFormIn,
  requestIdIn,
  rowCountIn,
  rowsIn,
  servedFileName,
  SIGN_IN_PATH,
  signInMessage,
  signInStage,
  TYPE_FILTER,
  viewStateIn,
} from "./pages.js";

const FORM_URLENCODED = { "content-type": "application/x-www-form-urlencoded" };

/**
 * SPV's sign-in, an F5 access policy at /my.policy: the user name and
 * password, then the code SPV e-mails, both posted to the same address with
 * `vhost=standard`. The code goes in the field named `password`, as measured.
 * A post that SPV accepts redirects away from /my.policy; one it refuses
 * renders the form again with its reason.
 */
export const makeLogin = (browser: Browser): LoginPort => {
  const post = (cookies: Cookies, fields: Readonly<Record<string, string>>) =>
    browser.go(cookies, SIGN_IN_PATH, { method: "POST", body: new URLSearchParams({ ...fields, vhost: "standard" }), headers: FORM_URLENCODED });

  return {
    begin: async () => {
      const page = await browser.go({}, "/");
      if (signInStage(textOf(page)) !== "password") fail(drift(`SPV's front page (${page.url.pathname}) is not its sign-in form`));
      return page.cookies;
    },
    submitPassword: async (cookies, credentials) => {
      const page = await post(cookies, { username: credentials.username, password: credentials.password });
      if (page.url.pathname !== SIGN_IN_PATH) return { kind: "signed_in", cookies: page.cookies };
      const html = textOf(page);
      return signInStage(html) === "code" ? { kind: "code_requested", cookies: page.cookies } : { kind: "refused", message: signInMessage(html) };
    },
    submitCode: async (cookies, code) => {
      const page = await post(cookies, { password: code });
      return page.url.pathname !== SIGN_IN_PATH ? { kind: "signed_in", cookies: page.cookies } : { kind: "refused", message: signInMessage(textOf(page)) };
    },
    end: async (cookies) => {
      await browser.go(cookies, "/vdesk/hangup.php3");
    },
  };
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  tiff: "image/tiff",
  rtf: "application/rtf",
  zip: "application/zip",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  gif: "image/gif",
  png: "image/png",
};

const contentTypeOf = (name: string): string => CONTENT_TYPES[/\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? ""] ?? "application/octet-stream";

const isHtml = (page: Page): boolean => (page.headers.get("content-type") ?? "").toLowerCase().includes("html");

/**
 * The pages behind the session: the message list ("Mesaje", a PrimeFaces
 * table) and the request form ("Solicitări"), both JSF. One operation at a
 * time on the session (`exclusive`, across processes on the same state dir),
 * because SPV keeps one rendered list per session and a listing's download
 * links are positions in it.
 */
export const makePortal = (browser: Browser, store: SessionStore, now: () => number, exclusive: Exclusive): PortalPort => {
  const withCookies = makeCookieRunner(browser, store, now, exclusive);

  /**
   * The whole list in one view (the page, then one paging request for every
   * row: PrimeFaces shows 20 a page), and `use` on it, in the same operation.
   * A download posts the row's link from this listing, on the same cookies.
   */
  const withMessages: PortalPort["withMessages"] = (use) =>
    withCookies(async (go) => {
      const html = textOf(await go(MESSAGES_PATH));
      const count = rowCountIn(html);
      const paging = new URLSearchParams({
        "javax.faces.partial.ajax": "true",
        "javax.faces.source": MESSAGES_TABLE,
        "javax.faces.partial.execute": MESSAGES_TABLE,
        "javax.faces.partial.render": MESSAGES_TABLE,
        [`${MESSAGES_TABLE}_pagination`]: "true",
        [`${MESSAGES_TABLE}_first`]: "0",
        [`${MESSAGES_TABLE}_rows`]: String(Math.max(count ?? 1000, 20)),
        [`${MESSAGES_TABLE}_encodeFeature`]: "true",
        [MESSAGES_FORM]: MESSAGES_FORM,
        [`${MESSAGES_FORM}_SUBMIT`]: "1",
        [TYPE_FILTER]: "",
        "javax.faces.ViewState": viewStateIn(html),
      });
      const partial = await go(MESSAGES_PATH, {
        method: "POST",
        body: paging,
        headers: { ...FORM_URLENCODED, "faces-request": "partial/ajax", "x-requested-with": "XMLHttpRequest" },
      });
      const updates = partialUpdates(textOf(partial));
      const table = updates.get(MESSAGES_TABLE) ?? fail(drift("the message list's paging answer carries no table"));
      const rows = rowsIn(table);
      if (count !== undefined && rows.length !== count) fail(drift(`the message list says ${count} rows but ${rows.length} came back`));
      const viewState = [...updates].find(([id]) => id.includes("ViewState"))?.[1] ?? viewStateIn(html);
      let open = true;
      const download = async (index: number): Promise<Downloaded> => {
        if (!open) fail(drift("a download from a listing whose operation has ended; list again"));
        const row = rows[index] ?? fail(drift(`no row ${index} in this listing`));
        const body = new FormData();
        body.set(TYPE_FILTER, "");
        body.set(`${MESSAGES_FORM}_SUBMIT`, "1");
        body.set("javax.faces.ViewState", viewState);
        body.set(`${MESSAGES_FORM}:_idcl`, row.link);
        const page = await go(MESSAGES_PATH, { method: "POST", body });
        if (isHtml(page)) fail(drift("SPV answered the download with a page instead of the document; list again and retry"));
        return {
          bytes: page.bytes,
          fileName: servedFileName(page.headers) ?? fail(drift("SPV served the document without a file name, so it cannot be checked against its message")),
          contentType: page.headers.get("content-type") ?? "application/octet-stream",
        };
      };
      try {
        return await use({ rows: rows.map(({ link: _link, ...row }) => row), download });
      } finally {
        open = false;
      }
    });

  const requestForm = (): Promise<RequestForm> =>
    withCookies(async (go) => {
      const form = requestFormIn(textOf(await go(REQUESTS_PATH)));
      return { identities: form.identities, personTypes: form.personTypes, companyTypes: form.companyTypes };
    });

  /** The form posted as the page posts it: a disabled field is left out, a read-only one sent empty. */
  const submitRequest: PortalPort["submitRequest"] = ({ cif, type, fields }) =>
    withCookies(async (go): Promise<Submitted> => {
      const formHtml = textOf(await go(REQUESTS_PATH));
      const form = requestFormIn(formHtml);
      const body = new URLSearchParams({
        "form1:cui": cif,
        "form1:TipDocument": type,
        "form1:pui": fields.pui,
        ...(fields.month === undefined ? {} : { "form1:LunaRaportare": fields.month }),
        ...(fields.monthFrom === undefined ? {} : { "form1:LunaInceput": fields.monthFrom }),
        ...(fields.monthTo === undefined ? {} : { "form1:LunaSfarsit": fields.monthTo }),
        "form1:AnRaportare": fields.year,
        "form1:nrInreg": fields.registrationNumber,
        [form.submitName]: "Trimite",
        form1_SUBMIT: "1",
        "javax.faces.ViewState": form.viewState,
      });
      const answer = textOf(await go(REQUESTS_PATH, { method: "POST", body, headers: FORM_URLENCODED }));
      const id = requestIdIn(answer);
      if (id !== undefined) return { kind: "registered", requestId: id };
      const said = addedLines(formHtml, answer);
      if (said.length === 0) fail(drift("SPV answered the request with no id and no message"));
      return { kind: "refused", message: said.join(" ").slice(0, 400) };
    });

  /** The contact form with its identities, fetched as the page's script fetches them when the markup has none. */
  const readContactForm = async (go: Go): Promise<{ readonly html: string; readonly form: ContactPage }> => {
    const page = await go(CONTACT_PATH);
    const html = textOf(page);
    const form = contactFormIn(html, page.url);
    if (form.identitiesFrom === undefined) return { html, form };
    const answer = textOf(await go(form.identitiesFrom));
    let json: unknown;
    try {
      json = JSON.parse(answer);
    } catch {
      return fail(drift(`SPV's identity list for the contact form is not JSON: ${answer.replace(/\s+/g, " ").slice(0, 200)}`));
    }
    const identities = identitiesIn(json);
    return { html, form: { ...form, identities, preselected: identities[0]?.value } };
  };

  const contactForm: PortalPort["contactForm"] = () =>
    withCookies(async (go) => {
      const { action: _action, hidden: _hidden, submit: _submit, identitiesFrom: _from, ...form } = (await readContactForm(go)).form;
      return form;
    });

  /**
   * The contact form posted as the page posts it (multipart, its hidden inputs
   * as they came, the submit button's name), on a fresh rendering of the form
   * in the same operation. `subcategSolicit` goes as the page's placeholder when
   * the category takes none, as a browser sends the select's value.
   */
  const submitContact: PortalPort["submitContact"] = (message) =>
    withCookies(async (go): Promise<ContactOutcome> => {
      const { html: formHtml, form } = await readContactForm(go);
      if (!form.identities.some((i) => i.value === message.cif)) fail(drift(`SPV's contact form no longer offers ${message.cif}; nothing was sent`));
      const body = new FormData();
      for (const [name, value] of form.hidden) body.append(name, value);
      body.set("cif_ales", message.cif);
      body.set("categSolicit", message.category);
      body.set("subcategSolicit", message.subcategory ?? "0");
      body.set("textintrebare", message.text.replace(/\n/g, "\r\n"));
      const file = message.attachment;
      body.set("docum", file === undefined ? new Blob([]) : new Blob([file.bytes], { type: contentTypeOf(file.name) }), file?.name ?? "");
      if (form.submit !== undefined) body.set(form.submit[0], form.submit[1]);
      const answer = textOf(await go(form.action, { method: "POST", body }));
      const read = contactAnswerIn(answer);
      if (read.kind === "registered") return read;
      const said = addedLines(formHtml, answer);
      return { kind: "not_registered", message: said.length > 0 ? said.join(" ").slice(0, 400) : "SPV showed the contact form again with no registration number and no message" };
    });

  return {
    contactForm,
    submitContact,
    probe: () =>
      withCookies(async (go) => {
        await go(MESSAGES_PATH);
      }),
    withMessages,
    requestForm,
    submitRequest,
  };
};
