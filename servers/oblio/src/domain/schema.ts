/**
 * Oblio's wire types, MODELLED BY HAND because Oblio publishes no
 * machine-readable schema.
 *
 * Checked 2026-09-28: no OpenAPI, Swagger or JSON Schema on www.oblio.eu, and
 * none in any of Oblio's own SDKs (github.com/OblioSoftware: OblioApi for PHP
 * at 027a5cc, OblioApiJs at 3797209, oblioapigo at 510c12d, oblio_api_python
 * at c1098fe), which all pass untyped maps.
 *
 * Sources, in order of authority:
 *   1. https://www.oblio.eu/api, fetched 2026-09-28 (the parameter tables and
 *      the example responses).
 *   2. The PHP SDK, github.com/OblioSoftware/OblioApi src/Api.php @ 027a5cc:
 *      the HTTP method and body encoding of every call (cancel and restore are
 *      PUT with a JSON body, delete is DELETE with a JSON body), and its
 *      create_invoice example, which sends `price` as a STRING.
 *   3. Recorded responses in github.com/vcraescu/go-oblio-api testdata
 *      (third party): Oblio sends a flag as `true`, `1` or `"1"` depending on
 *      the endpoint, which is why every flag below is `WireFlagIn`.
 *
 * Because these are claims rather than generated facts, infra/wire.ts PARSES
 * every response against them with zod: a field that changes type or goes
 * missing fails the call with reason `drift` instead of travelling on.
 * Fields beyond the documented ones are dropped by that parse, not relayed.
 *
 * `import type` only, from domain/ and app/; nothing here runs.
 */

// ---------------------------------------------------------------- requests

/** What Oblio accepts for a yes/no parameter: "ia valorile 0 sau 1". */
export type WireFlag = 0 | 1;

/** "Parametri client". Only `name` is required. */
export type WireClientIn = {
  readonly cif?: string;
  readonly name: string;
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
  readonly vatPayer?: WireFlag;
  readonly save?: WireFlag;
  readonly autocomplete?: WireFlag;
};

/**
 * "Parametri produs". Amounts go as decimal strings: the PHP SDK's own example
 * sends `'price' => '100'`, and Oblio's backend is PHP, which reads a numeric
 * string exactly where a JSON number would first pass through a double.
 */
export type WireProductIn = {
  readonly name: string;
  readonly code?: string;
  readonly description?: string;
  readonly price: string;
  readonly quantity: string;
  readonly measuringUnit?: string;
  readonly vatName?: string;
  readonly vatPercentage: string;
  readonly vatIncluded: WireFlag;
  readonly productType?: string;
  readonly management?: string;
  readonly save?: WireFlag;
};

/** "Parametri incasare document". */
export type WireCollectIn = {
  readonly type: string;
  readonly seriesName?: string;
  readonly documentNumber?: string;
  readonly value?: string;
  readonly issueDate?: string;
  readonly mentions?: string;
};

/** "Parametri document", shared by proformas and invoices. */
export type WireDocumentIn = {
  readonly cif: string;
  readonly client: WireClientIn;
  readonly issueDate?: string;
  readonly dueDate?: string;
  readonly seriesName: string;
  readonly language?: string;
  readonly precision: number;
  readonly currency: string;
  readonly exchangeRate?: string;
  readonly products: readonly WireProductIn[];
  readonly issuerName?: string;
  readonly internalNote?: string;
  readonly mentions?: string;
  readonly workStation?: string;
  readonly sendEmail?: WireFlag;
  readonly orderNumber?: string;
  readonly contractNumber?: string;
  readonly idempotencyKey?: string;
};

/** The invoice-only additions. */
export type WireInvoiceIn = WireDocumentIn & {
  readonly deliveryDate?: string;
  readonly collectDate?: string;
  readonly collect?: WireCollectIn;
  readonly useStock?: WireFlag;
};

/** "Exemplu de fisier JSON pentru factura pe baza de proforma". */
export type WireFromProformaIn = {
  readonly cif: string;
  readonly seriesName: string;
  readonly referenceDocument: { readonly type: "Proforma"; readonly seriesName: string; readonly number: string };
  readonly idempotencyKey?: string;
};

/**
 * "Parametri incasare factura", PUT /api/docs/invoice/collect, as JSON (the PHP
 * SDK's `collect`). `idempotencyKey` is documented on issuing and deleting, not
 * here; it is sent all the same, and nothing relies on Oblio honouring it.
 */
export type WireCollectInvoiceIn = {
  readonly cif: string;
  readonly seriesName: string;
  readonly number: string;
  readonly collect: WireCollectIn;
  readonly idempotencyKey?: string;
};

/**
 * "Exemplu de fisier JSON pentru stornare totala de factura": a new invoice in
 * `seriesName` that references the one it reverses ("Parametri document de
 * referinta"). `refund` is "Sterge incasarea asociata cu factura stornata",
 * 0 or 1; Oblio does not document its default, so it is always sent.
 */
export type WireReversalIn = {
  readonly cif: string;
  readonly seriesName: string;
  readonly referenceDocument: {
    readonly type: "Factura";
    readonly seriesName: string;
    readonly number: string;
    readonly refund: WireFlag;
  };
  readonly idempotencyKey?: string;
};

/** "Parametri anulare / restaurare / stergere document". */
export type WireDocumentRefIn = { readonly cif: string; readonly seriesName: string; readonly number: string };

/** A list filter on a yes/no property: "-1 - este ignorat, 0 - nu sunt ..., 1 - sunt ...". */
export type WireTriFlag = -1 | 0 | 1;

/**
 * "Parametri listare documente", GET /api/docs/invoice/list, sent as a query
 * (the PHP SDK's `list`, examples/list_invoices.php). The client filter is a
 * map, which a query carries in PHP's bracket form, `client[cif]=...`.
 * `id` and `withProducts` are documented and not sent: a listed product's
 * shape is not documented.
 */
export type WireInvoiceListIn = {
  readonly cif: string;
  readonly seriesName?: string;
  /** Sent only to find one invoice, with its series (findInvoice). */
  readonly number?: string;
  readonly "client[cif]"?: string;
  readonly "client[email]"?: string;
  readonly "client[code]"?: string;
  readonly draft?: WireTriFlag;
  readonly canceled?: WireTriFlag;
  readonly collected?: WireTriFlag;
  /** "Data de inceput", AAAA-LL-ZZ. */
  readonly issuedAfter?: string;
  /** "Data de sfarsit", AAAA-LL-ZZ. */
  readonly issuedBefore?: string;
  readonly withCollects?: WireFlag;
  readonly withEinvoiceStatus?: WireFlag;
  readonly orderBy?: "id" | "issueDate" | "number";
  readonly orderDir?: "ASC" | "DESC";
  /** "Rezultate pe pagina. Maxim 100". */
  readonly limitPerPage?: number;
  readonly offset?: number;
};

// --------------------------------------------------------------- responses

/**
 * Absent, null, or a value. Oblio pads with null in places (`indexUpload: null`
 * on a listed invoice), and zod reports an absent optional field as undefined.
 */
export type Maybe<T> = T | null | undefined;

/** A flag as Oblio sends it back: a boolean on some endpoints, 0/1 or "0"/"1" on others. */
export type WireFlagIn = boolean | 0 | 1 | "0" | "1";

/** A decimal as Oblio sends it back: "119.00" on most endpoints, a bare 428.4 on collects. */
export type WireDecimalIn = string | number;

/** Every response: `status`, `statusMessage`, and the answer under `data`. */
export type WireEnvelope<T> = { readonly status: number; readonly statusMessage: string; readonly data: T };

/** GET /api/nomenclature/companies. */
export type WireCompany = {
  readonly cif: string;
  readonly company: string;
  readonly userTypeAccess?: Maybe<string>;
  readonly useStock?: Maybe<WireFlagIn>;
};

/** GET /api/nomenclature/vat_rates. The field is `percent` here and `vatPercentage` on a product. */
export type WireVatRate = {
  readonly name: string;
  readonly percent: WireDecimalIn;
  readonly default?: Maybe<WireFlagIn>;
};

/** GET /api/nomenclature/clients, and `client` on a listed document. */
export type WireClientOut = {
  readonly clientId?: Maybe<string>;
  readonly cif?: Maybe<string>;
  readonly name: string;
  readonly rc?: Maybe<string>;
  readonly code?: Maybe<string>;
  readonly address?: Maybe<string>;
  readonly state?: Maybe<string>;
  readonly city?: Maybe<string>;
  readonly country?: Maybe<string>;
  readonly iban?: Maybe<string>;
  readonly bank?: Maybe<string>;
  readonly email?: Maybe<string>;
  readonly phone?: Maybe<string>;
  readonly contact?: Maybe<string>;
  readonly vatPayer?: Maybe<WireFlagIn>;
};

/** One management's stock of a product, with stock enabled. */
export type WireStock = {
  readonly workStation?: Maybe<string>;
  readonly management?: Maybe<string>;
  readonly quantity?: Maybe<WireDecimalIn>;
  readonly price?: Maybe<WireDecimalIn>;
  readonly currency?: Maybe<string>;
  readonly vatName?: Maybe<string>;
  readonly vatPercentage?: Maybe<WireDecimalIn>;
  readonly vatIncluded?: Maybe<WireFlagIn>;
};

/**
 * GET /api/nomenclature/products. A service carries its price directly; a
 * stocked product carries it per management under `stock` instead.
 */
export type WireProductOut = {
  readonly name: string;
  readonly code?: Maybe<string>;
  readonly description?: Maybe<string>;
  readonly measuringUnit?: Maybe<string>;
  readonly productType?: Maybe<string>;
  readonly price?: Maybe<WireDecimalIn>;
  readonly currency?: Maybe<string>;
  readonly vatName?: Maybe<string>;
  readonly vatPercentage?: Maybe<WireDecimalIn>;
  readonly vatIncluded?: Maybe<WireFlagIn>;
  readonly stock?: Maybe<readonly WireStock[]>;
};

/** GET /api/nomenclature/series. `start` and `next` are zero-padded strings, "0051". */
export type WireSeries = {
  readonly type: string;
  readonly name: string;
  readonly start?: Maybe<string | number>;
  readonly next?: Maybe<string | number>;
  readonly default?: Maybe<WireFlagIn>;
};

/** A payment recorded against an invoice. */
export type WireCollectOut = {
  readonly issueDate?: Maybe<string>;
  readonly type?: Maybe<string>;
  readonly number?: Maybe<string>;
  readonly value?: Maybe<WireDecimalIn>;
};

/** POST /api/docs/invoice and /proforma: what was just issued. */
export type WireIssued = {
  readonly seriesName: string;
  readonly number: string | number;
  readonly link?: Maybe<string>;
  readonly einvoice?: Maybe<string>;
};

/**
 * GET /api/docs/invoice and /proforma, and what cancel and restore answer. The
 * view documents documentType, seriesName, number, link and collects; `total`
 * and `einvoice` are documented on the invoice list and kept when present.
 */
export type WireDocumentOut = {
  readonly documentType?: Maybe<string>;
  readonly seriesName: string;
  readonly number: string | number;
  readonly link?: Maybe<string>;
  readonly einvoice?: Maybe<string>;
  readonly total?: Maybe<WireDecimalIn>;
  readonly collects?: Maybe<readonly WireCollectOut[]>;
};

/**
 * A document's state in ANAF's SPV, as Oblio reports it on a listed invoice
 * (`withEinvoiceStatus`). The codes are those of "Trimite factura in SPV":
 * -1 not sent, 0 in SPV and being processed, 1 sent, 2 has errors and was
 * not sent. `text` is Oblio's sentence ("Neconfigurat" with -1).
 */
export type WireEinvoiceStatus = {
  readonly text?: Maybe<string>;
  readonly sent?: Maybe<WireFlagIn>;
  readonly code: number | string;
};

/**
 * One row of GET /api/docs/invoice/list, as its example response shows it.
 * Every value is a string there ("draft": "0", "total": "51.2700",
 * "exchangeRate": "0.000000" on a RON invoice). Fields the example carries and
 * this server does not use (precision, issuerName, issuerId, the deputy and
 * notice fields, mentions, useStock, indexUpload, idDownload, `type`, the
 * e-Factura XML link that get_invoice gives, and `draft`, which the query pins
 * to 0) are not modelled, so the parse drops them.
 */
export type WireListedInvoice = {
  readonly id: string | number;
  readonly canceled: WireFlagIn;
  readonly seriesName: string;
  readonly number: string | number;
  readonly issueDate: string;
  readonly dueDate?: Maybe<string>;
  readonly currency: string;
  readonly exchangeRate?: Maybe<WireDecimalIn>;
  readonly total: WireDecimalIn;
  readonly link?: Maybe<string>;
  readonly einvoiceStatus?: Maybe<WireEinvoiceStatus>;
  readonly client?: Maybe<WireClientOut>;
  /**
   * With `withCollects`, the payments recorded against it, in the shape the
   * document view documents (issueDate, type, number, value).
   */
  readonly collects?: Maybe<readonly WireCollectOut[]>;
};

/** DELETE /api/docs/invoice: the document that was removed, without a link. */
export type WireDeleted = {
  readonly documentType?: Maybe<string>;
  readonly seriesName: string;
  readonly number: string | number;
};
