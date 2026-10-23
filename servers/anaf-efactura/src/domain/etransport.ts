import { parseStamp } from "./messages.js";
import type { RawDeclaration, RawEtransportList } from "./schema.js";

/**
 * e-Transport declarations, once ANAF's wire shape is behind us.
 *
 * Not e-Factura messages: a row is a transport declaration (a UIT code, the
 * trading partner, the carrier, the vehicle), or a declaration ANAF refused,
 * which carries its reasons in `mesaje` instead. The listing documents which
 * fields each kind carries; every one is optional here and stays `undefined`
 * when absent, because a refused declaration has no partner and a valid one
 * has no errors.
 */

export type Party = {
  readonly country: string | undefined;
  /** For a Romanian party, its CIF (or `PF` for a private person whose CNP is unknown). */
  readonly code: string | undefined;
  readonly name: string | undefined;
};

export type DeclarationMessage = {
  /** `ERR`, `WARN` or `INFO`. */
  readonly level: string | undefined;
  readonly text: string | undefined;
};

export type Declaration = {
  /** The UIT code the goods travel under. Absent on most refused declarations. */
  readonly uit: string | undefined;
  readonly declarantCif: string | undefined;
  readonly reference: string | undefined;
  /** `A` through the API, `I` through ANAF's web app. */
  readonly source: string | undefined;
  readonly uploadId: string | undefined;
  readonly createdAtLocal: string | undefined;
  /** 10=AIC, 12=LHI, 14=SCI, 20=LIC, 22=LHE, 24=SCE, 30=TTN, 40=IMP, 50=EXP, 60=DIN, 70=DIE. */
  readonly operationType: string | undefined;
  readonly transportDate: string | undefined;
  readonly partner: Party;
  readonly carrier: Party;
  readonly vehicle: { readonly tractor: string | undefined; readonly trailer1: string | undefined; readonly trailer2: string | undefined };
  /** True when ANAF attached at least one `ERR`: the declaration was refused. */
  readonly refused: boolean;
  readonly messages: readonly DeclarationMessage[];
};

export const declaration = (raw: RawDeclaration): Declaration => {
  const messages = (raw.mesaje ?? []).map((m) => ({ level: m.tip, text: m.mesaj }));
  return {
    uit: raw.uit,
    declarantCif: raw.cod_decl,
    reference: raw.ref_decl,
    source: raw.sursa,
    uploadId: raw.id_incarcare,
    createdAtLocal: parseStamp(raw.data_creare),
    operationType: raw.tip_op,
    transportDate: parseStamp(raw.data_transp)?.slice(0, 10),
    partner: { country: raw.pc_tara, code: raw.pc_cod, name: raw.pc_den },
    carrier: { country: raw.tr_tara, code: raw.tr_cod, name: raw.tr_den },
    vehicle: { tractor: raw.nr_veh, trailer1: raw.nr_rem1, trailer2: raw.nr_rem2 },
    refused: messages.some((m) => m.level === "ERR"),
    messages,
  };
};

export type DeclarationListing = {
  readonly count: number;
  readonly declarations: readonly Declaration[];
  /**
   * ANAF's refusal, or its "no messages in the last N days", which it reports
   * the same way (`Errors` with `ExecutionStatus: 1`). Surfaced rather than
   * mapped to an empty list, for the same reason as the e-Factura listing.
   */
  readonly notice: string | undefined;
};

/** `cui` is dropped for the reason messages.ts gives: it carries the certificate holder's CNP. */
export const declarationListing = (raw: RawEtransportList): DeclarationListing => {
  const errors = (raw.Errors ?? []).flatMap((e) => (e.errorMessage === undefined ? [] : [e.errorMessage]));
  return {
    count: raw.mesaje?.length ?? 0,
    declarations: (raw.mesaje ?? []).map(declaration),
    notice: errors.length > 0 ? errors.join("; ") : raw.ExecutionStatus === 0 ? undefined : `ExecutionStatus ${raw.ExecutionStatus}`,
  };
};
