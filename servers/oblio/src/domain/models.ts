/**
 * What this server answers with: Oblio's records, normalised once at the
 * boundary (infra/wire.ts) so no caller has to know Oblio's quirks.
 *
 * - A flag is a boolean, whichever of `true`, `1` or `"1"` Oblio sent.
 * - A decimal is a STRING, exactly as Oblio wrote it; a number Oblio sent bare
 *   is turned into text only when it provably survived JSON parsing.
 * - An empty string is ABSENT. Oblio pads every record with `""` for fields
 *   nobody filled, and an empty `iban` reads as an answer when it is not one.
 * - A series number stays text: "0051" is not 51.
 */

export type Company = {
  readonly cif: string;
  readonly name: string;
  /** The account's role on it, "admin" and so on. */
  readonly access?: string;
  readonly useStock?: boolean;
};

export type VatRate = {
  readonly name: string;
  readonly percent: string;
  /** False when Oblio did not say. */
  readonly isDefault: boolean;
};

export type Client = {
  readonly name: string;
  readonly cif?: string;
  readonly rc?: string;
  readonly code?: string;
  readonly address?: string;
  readonly state?: string;
  readonly city?: string;
  readonly country?: string;
  readonly iban?: string;
  readonly bank?: string;
  readonly email?: string;
  readonly phone?: string;
  readonly contact?: string;
  readonly vatPayer?: boolean;
};

export type StockEntry = {
  readonly workStation?: string;
  readonly management?: string;
  readonly quantity?: string;
  readonly price?: string;
  readonly currency?: string;
  readonly vatName?: string;
  readonly vatPercentage?: string;
  readonly vatIncluded?: boolean;
};

export type Product = {
  readonly name: string;
  readonly code?: string;
  readonly description?: string;
  readonly measuringUnit?: string;
  readonly productType?: string;
  readonly price?: string;
  readonly currency?: string;
  readonly vatName?: string;
  readonly vatPercentage?: string;
  readonly vatIncluded?: boolean;
  /** Per management, for a stocked product. Absent for a service. */
  readonly stock?: readonly StockEntry[];
};

export type Series = {
  /** "Factura", "Proforma", "Chitanta" and so on. */
  readonly type: string;
  readonly name: string;
  readonly start?: string;
  /** The number the next document will take, as of when this was read. */
  readonly next?: string;
  readonly isDefault: boolean;
};

export type Payment = {
  readonly issueDate?: string;
  readonly type?: string;
  readonly number?: string;
  readonly value?: string;
};

export type DocumentView = {
  readonly documentType?: string;
  readonly seriesName: string;
  readonly number: string;
  /** The PDF. */
  readonly link?: string;
  /** The e-Factura XML. */
  readonly einvoice?: string;
  readonly total?: string;
  readonly collects?: readonly Payment[];
};

/** A document just issued. */
export type Issued = {
  readonly seriesName: string;
  readonly number: string;
  readonly link?: string;
  readonly einvoice?: string;
};

/** Where a document stands in ANAF's SPV, by Oblio's code: -1, 0, 1, 2. */
export const EFACTURA_STATES = ["not_sent", "processing", "sent", "errors"] as const;
export type EfacturaState = (typeof EFACTURA_STATES)[number];

export type Efactura = {
  /** Absent for a code Oblio does not document; `code` then says which. */
  readonly state?: EfacturaState;
  readonly code: number;
  /** Oblio's own sentence, "Neconfigurat" and so on. */
  readonly text?: string;
};

/** The buyer as a listed invoice names it: enough to tell clients apart; list_clients has the rest. */
export type ListedClient = Pick<Client, "name" | "cif" | "code" | "email">;

/** One issued invoice, as the list shows it. */
export type ListedInvoice = {
  /** Oblio's own id: the order the list is kept in. */
  readonly id: string;
  readonly seriesName: string;
  readonly number: string;
  readonly issueDate: string;
  readonly dueDate?: string;
  readonly currency: string;
  /** Only for a document in another currency than RON. */
  readonly exchangeRate?: string;
  /** With VAT, as Oblio wrote it ("51.2700"). */
  readonly total: string;
  readonly cancelled: boolean;
  readonly client?: ListedClient;
  /** The payments recorded against it; absent when none are. */
  readonly collects?: readonly Payment[];
  readonly efactura?: Efactura;
  /** The PDF. */
  readonly link?: string;
};
