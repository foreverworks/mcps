import { fail, inputError, notFound } from "../../domain/errors.js";
import { folded } from "../../domain/messages.js";
import { isoAt } from "../../domain/dates.js";
import { type CuiOnly, cuiOnlyAmong, fieldsFor, type RequestArgs, saysCuiOnly, typeView } from "../../domain/requests.js";
import type { Deps, RequestForm } from "../ports.js";
import { withSession } from "./session.js";

/** A 13-digit tax id is a person's CNP; the form offers a person's list for it and a company's list for anything else. */
const isPerson = (cif: string): boolean => /^\d{13}$/.test(cif);

const typesFor = (form: RequestForm, cif: string): readonly string[] => (isPerson(cif) ? form.personTypes : form.companyTypes);

const identityOf = (form: RequestForm, requested: string | undefined): string => {
  if (requested === undefined) return form.identities[0] ?? fail(notFound("SPV offers this account no identity to request documents for"));
  const cif = requested.trim();
  return form.identities.includes(cif) ? cif : fail(inputError(`this account may request documents for ${form.identities.join(", ")}, not ${cif}`));
};

/** The types the form offers `cif` that SPV makes only for a company: none for a company itself. */
const cuiOnlyFor = async (deps: Deps, cif: string, offered: readonly string[]): Promise<readonly CuiOnly[]> =>
  isPerson(cif) ? cuiOnlyAmong(offered, await deps.cuiOnly.read()) : [];

const cuiOnlyView = (c: CuiOnly) => (c.source === "known" ? { type: c.type, source: c.source } : { type: c.type, source: c.source, learned_at: isoAt(c.learnedAtMs), spv_said: c.spvSaid });

/**
 * What `cif` may request. For a person's CNP, the types SPV makes only for a
 * company are held out of `types` and listed under `cui_only` with why,
 * although the form offers them.
 */
export const listDocumentTypes = async (deps: Deps, args: { readonly cif: string | undefined }) => {
  const form = await withSession(deps, () => deps.portal.requestForm());
  const cif = identityOf(form, args.cif);
  const offered = typesFor(form, cif);
  const held = await cuiOnlyFor(deps, cif, offered);
  return {
    ok: true as const,
    identities: form.identities,
    cif,
    types: offered.filter((t) => !held.some((h) => h.type === t)).map(typeView),
    ...(held.length > 0 ? { cui_only: held.map(cuiOnlyView) } : {}),
  };
};

/**
 * Ask SPV for a document. The answer is not the document: SPV registers the
 * request and posts its reply in the message list a minute or two later
 * (await_reply). The type must be one the form offers this identity now.
 */
export const requestDocument = async (deps: Deps, args: RequestArgs & { readonly type: string; readonly cif: string | undefined }) => {
  const form = await withSession(deps, () => deps.portal.requestForm());
  const cif = identityOf(form, args.cif);
  const offered = typesFor(form, cif);
  const type = offered.find((t) => folded(t) === folded(args.type)) ?? fail(inputError(`SPV does not offer "${args.type}" for ${cif}; list_document_types names the ones it does`));
  const held = (await cuiOnlyFor(deps, cif, [type]))[0];
  if (held !== undefined) {
    fail(inputError(`SPV makes "${type}" only for a company's CUI${held.source === "learned" ? ` (it said so on ${isoAt(held.learnedAtMs)}: ${held.spvSaid})` : ""}; nothing was sent. Request it for a CUI`));
  }
  const fields = fieldsFor(type, args);
  const submitted = await withSession(deps, () => deps.portal.submitRequest({ cif, type, fields }));
  if (submitted.kind === "refused") {
    if (isPerson(cif) && saysCuiOnly(submitted.message)) {
      await deps.cuiOnly.learn(type, submitted.message);
      return fail({ kind: "refused", message: `${submitted.message} (remembered: list_document_types no longer offers "${type}" for a CNP)` });
    }
    return fail({ kind: "refused", message: submitted.message });
  }
  return {
    ok: true as const,
    request_id: submitted.requestId,
    cif,
    type,
    next: "SPV posts the answer as a RASPUNS SOLICITARE message carrying this request_id, usually within two minutes: call await_reply with it",
  };
};
