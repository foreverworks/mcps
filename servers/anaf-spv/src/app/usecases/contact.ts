import { compact, type InputFile } from "@foreverworks/mcp-kit";

import { attachmentFits, attachmentName, type ContactArgs, type ContactForm, type ContactPlan, planFor, sameText } from "../../domain/contact.js";
import { isoAt } from "../../domain/dates.js";
import { fail, inputError } from "../../domain/errors.js";
import type { ContactEntry, Deps } from "../ports.js";
import { withSession } from "./session.js";

/**
 * SPV's contact form: a message to ANAF about the taxpayer's own record,
 * registered under the account's name, answered later in SPV as RASPUNS
 * SESIZARE FORMULAR UNIC DE CONTACT. Every send reaches ANAF, so the default
 * is a dry run: the live form is read, the message checked against it and
 * shown exactly as it would go, and nothing is posted.
 */

export type ContactCall = ContactArgs & {
  /** A file in the server's file roots (its inbox), and optionally the SHA-256 it must have. */
  readonly attachment: { readonly path: string; readonly sha256: string | undefined } | undefined;
  readonly dryRun: boolean;
  /** Send even though this same message was sent, or tried, before. */
  readonly again: boolean;
};

type Attachment = { readonly name: string; readonly file: InputFile };

const readAttachment = async (deps: Deps, given: ContactCall["attachment"]): Promise<Attachment | undefined> => {
  if (given === undefined) return undefined;
  const file = await deps.inputFiles({ path: given.path, sha256: given.sha256 });
  const name = attachmentName(file.name);
  attachmentFits(name, file.size);
  return { name, file };
};

/** The same message twice: same identity, category, text and attachment bytes. */
const fingerprintOf = (deps: Deps, plan: ContactPlan, attachment: Attachment | undefined): string =>
  deps.sha256(new TextEncoder().encode(JSON.stringify([plan.identity.value, plan.category.value, plan.subcategory?.value ?? "", plan.text, attachment?.file.sha256 ?? ""])));

const formView = (form: ContactForm) => ({
  identities: form.identities.map((i) => ({ cif: i.value, label: i.label })),
  preselected: form.preselected,
  categories: form.categories,
});

/** The message exactly as it goes, read back from what the form offers. */
const messageView = (plan: ContactPlan, attachment: Attachment | undefined) =>
  compact({
    cif: plan.identity.value,
    identity: plan.identity.label,
    category: plan.category,
    subcategory: plan.subcategory,
    text: plan.text,
    characters: plan.text.length,
    attachment: attachment === undefined ? undefined : { name: attachment.name, bytes: attachment.file.size, sha256: attachment.file.sha256 },
  });

const entryView = (entry: ContactEntry) =>
  entry.outcome === "registered"
    ? { outcome: entry.outcome, at: isoAt(entry.atMs), registration_number: entry.registrationNumber, registered_on: entry.registeredOn }
    : { outcome: entry.outcome, at: isoAt(entry.atMs) };

/** dd.mm.yyyy as YYYY-MM-DD. */
const isoDay = (shown: string): string => shown.split(".").reverse().join("-");

export const submitContactForm = async (deps: Deps, args: ContactCall) => {
  const attachment = await readAttachment(deps, args.attachment);
  const form = await withSession(deps, () => deps.portal.contactForm());
  const plan = planFor(form, args);
  const fingerprint = fingerprintOf(deps, plan, attachment);
  const before = (await deps.contacts.read())[fingerprint];
  const message = messageView(plan, attachment);
  const repeated = before !== undefined && before.outcome !== "not_registered";

  if (args.dryRun) {
    return {
      ok: true as const,
      dry_run: true as const,
      sent: false as const,
      form: formView(form),
      message,
      ...(before === undefined ? {} : { sent_before: entryView(before) }),
      next:
        plan.identity.value === form.preselected
          ? "nothing was sent; check message, then call again with dry_run: false to send it"
          : `nothing was sent; the form preselects ${form.preselected ?? "nothing"} and this sends as ${plan.identity.value}. Check message, then call again with dry_run: false`,
    };
  }

  if (repeated && !args.again) {
    fail(
      inputError(
        before.outcome === "registered"
          ? `this same message was registered on ${before.registeredOn} as ${before.registrationNumber}; nothing was sent. Pass again: true to send it once more`
          : `this same message was sent at ${isoAt(before.atMs)} and its answer never came, so it may be registered; nothing was sent. Look for SPV's confirmation e-mail, or pass again: true`,
      ),
    );
  }

  await deps.contacts.record(fingerprint, { outcome: "pending", atMs: deps.now() });
  const outcome = await withSession(deps, () =>
    deps.portal.submitContact({
      cif: plan.identity.value,
      category: plan.category.value,
      subcategory: plan.subcategory?.value,
      text: plan.text,
      attachment: attachment === undefined ? undefined : { name: attachment.name, bytes: attachment.file.bytes },
    }),
  );
  if (outcome.kind === "not_registered") {
    await deps.contacts.record(fingerprint, { outcome: "not_registered", atMs: deps.now() });
    return fail({ kind: "refused", message: `SPV did not register the message: ${outcome.message}` });
  }
  const r = outcome.registered;
  await deps.contacts.record(fingerprint, { outcome: "registered", atMs: deps.now(), registrationNumber: r.registrationNumber, registeredOn: isoDay(r.registeredOn) });
  return {
    ok: true as const,
    dry_run: false as const,
    sent: true as const,
    registration_number: r.registrationNumber,
    registered_on: isoDay(r.registeredOn),
    shown: compact({ cif: r.shownCif, text: r.shownText }),
    shown_matches: { cif: r.shownCif === plan.identity.value, text: r.shownText !== undefined && sameText(r.shownText, plan.text) },
    message,
    next: `ANAF answers in SPV as RASPUNS SESIZARE FORMULAR UNIC DE CONTACT naming ${r.registrationNumber}: list_messages with text "${r.registrationNumber}"`,
  };
};
