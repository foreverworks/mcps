import type { FormsPort, SessionStore, UploadOutcome } from "../../app/ports.js";
import { drift, fail } from "../../domain/errors.js";
import { type Browser, textOf } from "../browser.js";
import type { Exclusive } from "../store.js";
import { makeCookieRunner } from "./cookies.js";
import { attribute, tags, visibleText } from "./html.js";
import { addedLines } from "./pages.js";

/**
 * formularespv-pf.anaf.ro, where a person files the declarations SPV-PF takes
 * ("Depunere declaratie unica si alte formulare SPV-PF"). It signs in like
 * pfinternet (the same F5 policy: user name and password, then the e-mailed
 * code) but in a session of its own. A form's page (`/SNMD/d212/d212.xhtml`
 * for D212) is JSF: `form2` with one file input, a submit button "Transmitere
 * formular", `form2_SUBMIT` and the view state (read through a
 * browser). Accepted, it answers "Fisierul transmis de dumneavoastra a fost
 * preluat si a primit indexul de depunere: <N>"; the page also always shows
 * that sentence as an instruction, with "XXXXXXX" for the number.
 */

export type UploadPage = {
  readonly action: string;
  readonly fileField: string;
  readonly submit: readonly [string, string];
  readonly hidden: readonly (readonly [string, string])[];
};

export const uploadPageIn = (html: string, base: URL): UploadPage => {
  const forms = [...html.matchAll(/<form\b[^>]*>[\s\S]*?<\/form>/gi)].map((m) => m[0]);
  const form = forms.find((f) => tags(f, "input").some((t) => (attribute(t, "type") ?? "").toLowerCase() === "file")) ?? fail(drift("the filing page has no form with a file input"));
  const open = /^<form\b[^>]*>/i.exec(form)?.[0] ?? "";
  const action = new URL(attribute(open, "action") ?? base.pathname, base);
  if (action.origin !== base.origin) fail(drift(`the filing page posts to another site (${action.host})`));
  const inputs = tags(form, "input");
  const files = inputs.filter((t) => (attribute(t, "type") ?? "").toLowerCase() === "file");
  if (files.length !== 1) fail(drift(`the filing page's form has ${files.length} file inputs, not one`));
  const submits = [...inputs, ...tags(form, "button")].filter((t) => (attribute(t, "type") ?? "").toLowerCase() === "submit" && attribute(t, "name") !== undefined);
  if (submits.length !== 1) fail(drift(`the filing page's form has ${submits.length} named submit buttons, not one`));
  const submit = submits[0] ?? "";
  return {
    action: `${action.pathname}${action.search}`,
    fileField: attribute(files[0] ?? "", "name") ?? fail(drift("the filing page's file input has no name")),
    submit: [attribute(submit, "name") ?? "", attribute(submit, "value") ?? ""],
    hidden: inputs.filter((t) => (attribute(t, "type") ?? "").toLowerCase() === "hidden" && attribute(t, "name") !== undefined).map((t) => [attribute(t, "name") ?? "", attribute(t, "value") ?? ""] as const),
  };
};

/** The index de depunere a page announces, only as digits: the instruction's "XXXXXXX" is not one. */
export const filingIndexIn = (html: string): string | undefined => /indexul\s+de\s+depunere\s*:?\s*(\d{4,})/i.exec(visibleText(html))?.[1];

export const makeForms = (browser: Browser, store: SessionStore, now: () => number, exclusive: Exclusive): FormsPort => {
  const withCookies = makeCookieRunner(browser, store, now, exclusive);
  return {
    upload: ({ path, fileName, bytes }) =>
      withCookies(async (go): Promise<UploadOutcome> => {
        const page = await go(path);
        const formHtml = textOf(page);
        const form = uploadPageIn(formHtml, page.url);
        const body = new FormData();
        for (const [name, value] of form.hidden) body.append(name, value);
        body.set(form.fileField, new Blob([bytes], { type: "application/pdf" }), fileName);
        body.set(form.submit[0], form.submit[1]);
        const answer = textOf(await go(form.action, { method: "POST", body }));
        const index = filingIndexIn(answer);
        if (index !== undefined) return { kind: "accepted", index };
        const said = addedLines(formHtml, answer);
        return { kind: "refused", message: said.length > 0 ? said.join(" ").slice(0, 600) : "the filing page came back with no index de depunere and no message" };
      }),
  };
};
