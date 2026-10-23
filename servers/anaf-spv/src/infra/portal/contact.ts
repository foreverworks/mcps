import type { Choice, ContactForm, ContactRegistered } from "../../domain/contact.js";
import { drift, fail } from "../../domain/errors.js";
import { attribute, element, options, tags, visibleText } from "./html.js";

/**
 * SPV's contact form (`/asistspv/`, which SPV shows in an iframe behind the
 * envelope pictogram) and the page it answers with, as this server reads
 * them. Measured through a browser: one form, multipart, posting to
 * `asistspatiuprivat.do`, with `cif_ales`, `categSolicit`, `subcategSolicit`,
 * the textarea `textintrebare` (maxlength 1500), the file input `docum` and a
 * submit button named `submit`. The markup's `cif_ales` is empty: the page's
 * script fills it from `GetCuiuri`. Pure.
 */

export const CONTACT_PATH = "/asistspv/";

/** The form's markup reduced to what a post needs, beside what the use case checks. */
export type ContactPage = ContactForm & {
  /**
   * Where the page's script fetches the identity list, when the markup has
   * none: the live form renders `cif_ales` empty and fills it from
   * `GetCuiuri` (JSON); `identities` is then empty until
   * identitiesIn reads it.
   */
  readonly identitiesFrom: string | undefined;
  /** Where the form posts, as a path on the portal. */
  readonly action: string;
  /** Hidden inputs, sent back as they came. */
  readonly hidden: readonly (readonly [string, string])[];
  /** The submit button's name and value, which the post carries as a browser's would. */
  readonly submit: readonly [string, string] | undefined;
};

const PLACEHOLDER = "0";

/**
 * A select's options as a person sees them: options inside HTML comments are
 * not options (ANAF's form keeps retired ones that way), and a label that
 * wraps over lines in the markup is one line. Each keeps its `data-xxx`, the
 * category a subcategory belongs to on ANAF's public form.
 */
const choicesIn = (select: string): readonly (Choice & { readonly group: string | undefined })[] => {
  const live = select.replace(/<!--[\s\S]*?-->/g, "");
  const tagsOf = [...live.matchAll(/<option\b[^>]*>/gi)].map((m) => m[0]);
  return options(live).map((o, i) => ({ value: o.value, label: o.label.replace(/\s+/g, " ").trim(), group: attribute(tagsOf[i] ?? "", "data-xxx") }));
};

/**
 * The subcategory select holds one group per category that takes one: by
 * each option's `data-xxx` where the page marks them, else split at each
 * placeholder, in the page's order.
 */
const groupsOf = (choices: readonly (Choice & { readonly group: string | undefined })[]): ContactForm["subcategoryGroups"] => {
  const plain = (c: Choice): Choice => ({ value: c.value, label: c.label });
  if (choices.every((c) => c.group !== undefined)) {
    const groups = new Map<string, Choice[]>();
    for (const c of choices) if (c.value !== PLACEHOLDER) groups.set(c.group ?? "", [...(groups.get(c.group ?? "") ?? []), plain(c)]);
    return [...groups].map(([category, list]) => ({ category, choices: list }));
  }
  const groups: Choice[][] = [];
  for (const c of choices) {
    if (c.value === PLACEHOLDER) groups.push([]);
    else if (groups.length === 0) groups.push([plain(c)]);
    else groups[groups.length - 1]?.push(plain(c));
  }
  return groups.filter((g) => g.length > 0).map((list) => ({ category: undefined, choices: list }));
};

const selectNamed = (form: string, name: string): string => element(form, "select", "name", name) ?? fail(drift(`SPV's contact form has no ${name} select`));

/**
 * What a select that read as empty looks like, for the drift that reports it:
 * its markup, the scripts the page loads, and the inline script around any
 * mention of the select's name or id, all cut short.
 */
const emptySelectReport = (html: string, select: string, name: string): string => {
  const id = attribute(/^<select\b[^>]*>/i.exec(select)?.[0] ?? "", "id");
  const squeeze = (text: string, max: number) => text.replace(/\s+/g, " ").slice(0, max);
  const sources = tags(html, "script").flatMap((t) => attribute(t, "src") ?? []);
  const inline = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1] ?? "");
  const around = inline.flatMap((js) =>
    ["$.ajax", "url:", name, ...(id === undefined ? [] : [id])].flatMap((word) => {
      const at = js.indexOf(word);
      return at < 0 ? [] : [js.slice(Math.max(0, at - 100), at + 300)];
    }),
  );
  return (
    `SPV's contact form shows no ${name} options in its markup: ${squeeze(select, 300)}; scripts loaded: ${sources.join(", ") || "none"}` +
    `; inline script: ${around.length > 0 ? squeeze([...new Set(around)].join(" | "), 1200) : "none mentions it"}`
  );
};

/** The address the inline script that fills the select `#<id>` fetches its options from (jQuery's `$.ajax({ url: ... })`), on this site. */
const fillerUrlIn = (html: string, id: string | undefined, base: URL): string | undefined => {
  if (id === undefined) return undefined;
  for (const m of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const js = m[1] ?? "";
    if (!js.includes(`#${id}`)) continue;
    const url = /\$\.ajax\(\s*\{[\s\S]*?\burl\s*:\s*['"]([^'"]+)['"]/.exec(js)?.[1];
    if (url === undefined) continue;
    const at = new URL(url, base);
    return at.origin === base.origin ? `${at.pathname}${at.search}` : undefined;
  }
  return undefined;
};

/**
 * The identities as `GetCuiuri` answers them: `[{ cuicnp, denumire }]`, shown
 * by the page as "<cuicnp> -- <denumire>", in its order (the first is the one
 * preselected). An entry carrying only `eroare` is SPV saying why there is
 * none.
 */
export const identitiesIn = (json: unknown): readonly Choice[] => {
  const entries = Array.isArray(json) ? (json as readonly { cuicnp?: unknown; denumire?: unknown; eroare?: unknown }[]) : fail(drift("SPV's identity list for the contact form is not a JSON list"));
  const identities = entries.flatMap((e) =>
    typeof e.cuicnp === "string" || typeof e.cuicnp === "number" ? [{ value: String(e.cuicnp).trim(), label: `${String(e.cuicnp).trim()} -- ${String(e.denumire ?? "").trim()}` }] : [],
  );
  if (identities.length > 0) return identities;
  const said = entries.flatMap((e) => (typeof e.eroare === "string" && e.eroare.trim() !== "" ? [e.eroare.trim()] : []));
  return fail(drift(said.length > 0 ? `SPV's contact form offers no identity: ${said.join("; ").slice(0, 300)}` : "SPV's contact form offers no identity"));
};

/** The form, read from the page at `base` (the address it was served from, to resolve its action). */
export const contactFormIn = (html: string, base: URL): ContactPage => {
  const page = html.replace(/<!--[\s\S]*?-->/g, "");
  // From the LAST form tag before the identity select, so an unclosed form earlier on the page cannot lend its action.
  const at = page.search(/<select\b[^>]*name\s*=\s*["']?cif_ales\b/i);
  if (at < 0) fail(drift("SPV's contact page has no cif_ales select"));
  const start = page.slice(0, at).search(/<form\b[^>]*>(?![\s\S]*<form\b)/i);
  if (start < 0) fail(drift("SPV's contact page has its cif_ales select outside a form"));
  const end = page.indexOf("</form>", at);
  const form = page.slice(start, end < 0 ? undefined : end);
  const open = /^<form\b[^>]*>/i.exec(form)?.[0] ?? "";
  const action = new URL(attribute(open, "action") ?? base.pathname, base);
  if (action.origin !== base.origin) fail(drift(`SPV's contact form posts to another site (${action.host})`));
  const identitySelect = selectNamed(form, "cif_ales");
  const identities = choicesIn(identitySelect)
    .filter((o) => o.value !== "")
    .map((o) => ({ value: o.value, label: o.label }));
  const identitiesFrom = identities.length > 0 ? undefined : fillerUrlIn(page, attribute(/^<select\b[^>]*>/i.exec(identitySelect)?.[0] ?? "", "id"), base);
  if (identities.length === 0 && identitiesFrom === undefined) fail(drift(emptySelectReport(html, identitySelect, "cif_ales")));
  const selected = [...identitySelect.matchAll(/<option\b[^>]*>/gi)].map((m) => m[0]).find((t) => /\sselected\b/i.test(t));
  const textarea = tags(form, "textarea").find((t) => attribute(t, "name") === "textintrebare") ?? fail(drift("SPV's contact form has no textintrebare"));
  if (tags(form, "input").every((t) => attribute(t, "name") !== "docum")) fail(drift("SPV's contact form has no docum file input"));
  const button = [...tags(form, "button"), ...tags(form, "input")].find((t) => (attribute(t, "type") ?? "").toLowerCase() === "submit");
  const buttonName = button === undefined ? undefined : attribute(button, "name");
  return {
    action: `${action.pathname}${action.search}`,
    identitiesFrom,
    identities,
    preselected: selected === undefined ? identities[0]?.value : attribute(selected, "value"),
    categories: choicesIn(selectNamed(form, "categSolicit"))
      .filter((o) => o.value !== PLACEHOLDER)
      .map((o) => ({ value: o.value, label: o.label })),
    subcategoryGroups: groupsOf(choicesIn(selectNamed(form, "subcategSolicit"))),
    textMax: Number(attribute(textarea, "maxlength") ?? "1500") || 1500,
    hidden: tags(form, "input")
      .filter((t) => (attribute(t, "type") ?? "").toLowerCase() === "hidden" && attribute(t, "name") !== undefined)
      .map((t) => [attribute(t, "name") ?? "", attribute(t, "value") ?? ""] as const),
    submit: button === undefined || buttonName === undefined ? undefined : [buttonName, attribute(button, "value") ?? ""],
  };
};

/**
 * What SPV answered a post with. Registered, it shows "Cererea/Sesizarea dvs.
 * cu următoarele date:", "CNP/CUI: <cif>", "Număr de înregistrare: <11
 * digits>", "Data de înregistrare: dd.mm.yyyy", "Text întrebare: <the text>"
 * and "a fost trimisă cu succes!" (a confirmation page). Anything
 * else is a page that did not register it.
 */
export const contactAnswerIn = (html: string): { readonly kind: "registered"; readonly registered: ContactRegistered } | { readonly kind: "not_registered" } => {
  const text = visibleText(html);
  const number = /N[uú]m[aă]r\s+de\s+[iî]nregistrare\s*:?\s*(\d{6,})/i.exec(text)?.[1];
  const success = /a\s+fost\s+trimis[aă]\s+cu\s+succes/i.test(text);
  if (number === undefined) {
    if (success) fail(drift("SPV says the message was sent but shows no registration number; do not send it again, look for SPV's confirmation e-mail"));
    return { kind: "not_registered" };
  }
  const on = /Data\s+de\s+[iî]nregistrare\s*:?\s*(\d{2}\.\d{2}\.\d{4})/i.exec(text)?.[1] ?? fail(drift(`SPV registered the message as ${number} but shows no registration date`));
  return {
    kind: "registered",
    registered: {
      registrationNumber: number,
      registeredOn: on,
      shownCif: /CNP\s*\/\s*CUI\s*:?\s*(\d+)/i.exec(text)?.[1],
      shownText: /Text\s+[iî]ntrebare\s*:?\s*([\s\S]*?)\s*a\s+fost\s+trimis[aă]/i.exec(text)?.[1],
    },
  };
};
