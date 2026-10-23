/**
 * What the use cases need, stated as functions rather than objects with
 * behaviour. Everything here is an interface the infra layer satisfies; nothing
 * in app/ or domain/ ever imports from infra/.
 *
 * This port names OPERATIONS, not endpoints, and speaks the domain's models:
 * a draft goes in, a normalised record comes out. Oblio's field names and
 * flags stop in infra/.
 */
import type { Collect, DocumentRef, FromProformaDraft, InvoiceDraft, ProformaDraft } from "../domain/document.js";
import type { InvoiceFilter } from "../domain/invoiceList.js";
import type { ReversalPlan } from "../domain/reversal.js";
import type { Client, Company, DocumentView, Issued, ListedInvoice, Product, Series, VatRate } from "../domain/models.js";

/** Every call is scoped to one company. */
export type Scoped<T = object> = { readonly cif: string } & T;

export type ClientQuery = Scoped<{ readonly name?: string; readonly clientCif?: string; readonly offset: number }>;
export type ProductQuery = Scoped<{ readonly name?: string; readonly code?: string; readonly offset: number }>;
export type RefQuery = Scoped<{ readonly ref: DocumentRef }>;
/** One page of issued invoices: `limit` rows from position `offset` of the filtered list. */
export type InvoiceListQuery = Scoped<{ readonly filter: InvoiceFilter; readonly offset: number; readonly limit: number }>;

export type OblioPort = {
  readonly listCompanies: () => Promise<readonly Company[]>;
  readonly listClients: (q: ClientQuery) => Promise<readonly Client[]>;
  readonly listProducts: (q: ProductQuery) => Promise<readonly Product[]>;
  readonly listSeries: (q: Scoped) => Promise<readonly Series[]>;
  readonly listVatRates: (q: Scoped) => Promise<readonly VatRate[]>;

  readonly getInvoice: (q: RefQuery) => Promise<DocumentView>;
  readonly getProforma: (q: RefQuery) => Promise<DocumentView>;
  readonly listInvoices: (q: InvoiceListQuery) => Promise<readonly ListedInvoice[]>;
  /** One issued invoice as the list shows it (buyer, currency, total, payments), or undefined when there is none. */
  readonly findInvoice: (q: RefQuery) => Promise<ListedInvoice | undefined>;

  readonly issueInvoice: (r: Scoped<{ readonly draft: InvoiceDraft }>) => Promise<Issued>;
  readonly issueProforma: (r: Scoped<{ readonly draft: ProformaDraft }>) => Promise<Issued>;
  readonly issueInvoiceFromProforma: (r: Scoped<{ readonly draft: FromProformaDraft }>) => Promise<Issued>;
  /** A storno: a new invoice in the plan's series that reverses the plan's invoice in full. */
  readonly issueReversal: (r: Scoped<{ readonly plan: Pick<ReversalPlan, "ref" | "seriesName" | "removePayments" | "idempotencyKey"> }>) => Promise<Issued>;

  /** Records a payment. Never sent twice by the transport: a second one would be a second payment. */
  readonly collectInvoice: (q: RefQuery & { readonly payment: Collect; readonly idempotencyKey: string }) => Promise<DocumentView>;

  readonly cancelInvoice: (q: RefQuery) => Promise<DocumentView>;
  readonly restoreInvoice: (q: RefQuery) => Promise<DocumentView>;
  /** Permanent. A `money` tool, one layer out: the client confirms it with its user. */
  readonly deleteInvoice: (q: RefQuery) => Promise<DocumentRef>;
};

/**
 * Nomenclature that changes rarely, remembered for a while.
 *
 * `asOf` is when the value was READ from Oblio, in epoch milliseconds, so an
 * answer that came from memory says how old it is.
 */
export type Remembered<T> = { readonly value: T; readonly asOf: number };

export type NomenclatureCache = {
  readonly companies: () => Promise<Remembered<readonly Company[]>>;
  readonly series: (cif: string) => Promise<Remembered<readonly Series[]>>;
  readonly vatRates: (cif: string) => Promise<Remembered<readonly VatRate[]>>;
  /** After a document is issued or deleted: a series' `next` has moved. */
  readonly forgetSeries: () => void;
};

/** Where the configuration lives, for the tools that report on it. */
export type Paths = {
  /** app.json, read-only. Undefined when neither variable that names it is set. */
  readonly config: string | undefined;
  /** The writable directory holding the access-token cache. */
  readonly stateDir: string;
};

/** The non-secret half of app.json, for the tools that report on configuration. */
export type AppIdentity = {
  /** The Oblio account's login, which doubles as its client_id. Not a secret. */
  readonly accountId: string;
  /** The company every call acts on behalf of. */
  readonly companyCif: string;
};

export type Deps = {
  readonly oblio: OblioPort;
  readonly paths: Paths;
  readonly identity: () => Promise<AppIdentity>;
  readonly cache: NomenclatureCache;
  /** Milliseconds since the epoch: the day a document without an issue date is keyed by. */
  readonly now: () => number;
};
