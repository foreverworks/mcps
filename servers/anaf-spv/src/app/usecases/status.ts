import { compact } from "@foreverworks/mcp-kit";

import { dateAt, isoAt } from "../../domain/dates.js";
import { fail, inputError } from "../../domain/errors.js";
import { filingRefOf, isoDateOf, MEANING, registrationIn, stateOf, taxIdOf } from "../../domain/status.js";
import type { DeclarationEntry, Deps, StareRow } from "../ports.js";
import { saveDirOf } from "./messages.js";

/**
 * A filed declaration's state at ANAF and its receipt, by its number, at any
 * time after filing (feature plan S1). ANAF's public status service
 * (StareD112) answers by index de încărcare and tax id with no sign-in; this
 * server's own record of what it filed (declarations.json) turns the index de
 * depunere submit_declaration answered into that index, and supplies the tax
 * id. Reads only: nothing is signed in to, requested or filed.
 */

/** What this server knows of a filing it made, if it made it. */
const filedHere = (entry: DeclarationEntry) =>
  compact({
    form: entry.form,
    year: entry.year,
    pdf: entry.pdfName,
    sent_at: entry.filed === undefined ? undefined : isoAt(entry.filed.atMs),
    outcome: entry.filed?.outcome,
    index_de_depunere: entry.filed?.index,
    index_de_incarcare: entry.filed?.uploadIndex,
    registration_number: entry.filed?.registration,
  });

const rowView = (row: StareRow) => {
  const status = stateOf(row.state);
  const registration = registrationIn(row.registered);
  const on = /\bdin\s+(\d{2}\.\d{2}\.\d{4})/.exec(row.registered)?.[1];
  return compact({
    status,
    state: row.state,
    meaning: MEANING[status],
    form: row.document,
    registration_number: registration?.number,
    registered_on: on === undefined ? undefined : isoDateOf(on),
    uploaded_on: isoDateOf(row.uploaded),
  });
};

export const declarationStatus = async (
  deps: Deps,
  args: { readonly reference: string; readonly cif: string | undefined; readonly receipt: boolean; readonly saveDir: string | undefined },
) => {
  const ref = filingRefOf(args.reference);
  const dir = args.receipt ? saveDirOf(deps, args.saveDir) : undefined;
  const ledger = Object.values(await deps.declarations.read());
  const byUpload = ledger.find((e) => e.filed?.uploadIndex === ref.index);
  const byDepunere = byUpload === undefined ? ledger.find((e) => e.filed?.index === ref.index) : undefined;
  const entry = byUpload ?? byDepunere;
  // An index de depunere this server filed under becomes the index de încărcare its RECIPISA gave.
  const index = byDepunere?.filed?.uploadIndex ?? ref.index;
  const cif =
    args.cif !== undefined
      ? taxIdOf(args.cif)
      : entry?.cif !== undefined
        ? taxIdOf(entry.cif)
        : fail(inputError("cif is required: the CNP or CUI the declaration was filed for (ANAF's status service answers only the index and the tax id together)"));
  const here = entry === undefined ? {} : { filed_here: filedHere(entry) };
  const answer = await deps.stare.lookup({ index, cif });
  if (answer.kind === "refused") return fail(inputError(`ANAF's status service refused the query: "${answer.message}"`));
  const listed = answer.kind === "rows" ? answer : undefined;
  const row = listed?.rows.find((r) => r.index === index);
  if (listed === undefined || row === undefined) {
    const year = ref.year ?? byUpload?.filed?.registration?.slice(-4) ?? "<year filed>";
    return {
      ok: true as const,
      found: false as const,
      index,
      cif,
      ...here,
      checked_at: isoAt(deps.now()),
      next:
        byDepunere !== undefined && byDepunere.filed?.uploadIndex === undefined
          ? `${ref.index} is formularespv-pf's index de depunere; ANAF's status service knows a filing by its index de încărcare, printed on SPV's RECIPISA ` +
            `(list_messages type RECIPISA: the number in INTERNT-<index>-<year>); call again with that`
          : "ANAF's status service lists a tax id's last 200 filings of the last three months. For an older one, request_document type " +
            `"Duplicat Recipisa" with registration_number INTERNT-${index}-${year}, then await_reply (it answers for filings years old, ` +
            "but may not yet know one filed the same day). A number just filed may need a few minutes",
    };
  }
  const view = rowView(row);
  let receipt: Record<string, unknown> | undefined;
  if (dir !== undefined) {
    const bytes = row.receiptLinked ? await deps.stare.receipt(index) : undefined;
    if (bytes === undefined) {
      receipt = { saved: false, why: "ANAF serves a filing's receipt for 60 days after filing; for an older one, request_document type \"Duplicat Recipisa\"" };
    } else {
      const day = view.registered_on ?? view.uploaded_on ?? dateAt(deps.now());
      const saved = await deps.files.save(dir, `${day}_recipisa-stare_${index}.pdf`, bytes);
      receipt = { saved: true, path: saved.path, already_there: saved.present, bytes: bytes.byteLength, sha256: deps.sha256(bytes) };
    }
  }
  return {
    ok: true as const,
    found: true as const,
    index,
    cif,
    ...view,
    ...(receipt === undefined ? {} : { receipt }),
    ...here,
    window: compact({ from: isoDateOf(listed.from), to: isoDateOf(listed.to), filings_listed: listed.rows.length }),
    ...(view.status === "processing" ? { next: "call declaration_status again in a few minutes" } : {}),
  };
};
