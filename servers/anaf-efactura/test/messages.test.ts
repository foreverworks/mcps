/**
 * The mapping rules, on their own. Every one of these is a pure function of one
 * ANAF response, so the awkward parts are provable without a certificate.
 */
import { describe, expect, it } from "vitest";

import {
  invoiceMessage,
  messageKind,
  messageListing,
  pagedMessageListing,
  parseDetails,
  parseStamp,
} from "../src/domain/messages.js";
import { statusReceipt, uploadReceipt } from "../src/domain/receipts.js";

describe("messageKind", () => {
  it("maps ANAF's four labels to something a filter can use", () => {
    expect(messageKind("FACTURA TRIMISA")).toBe("sent");
    expect(messageKind("FACTURA PRIMITA")).toBe("received");
    expect(messageKind("ERORI FACTURA")).toBe("error");
    expect(messageKind("MESAJ CUMPARATOR")).toBe("buyerMessage");
  });

  it("collapses anything else to unknown rather than guessing", () => {
    expect(messageKind("FACTURA VIITOARE")).toBe("unknown");
    expect(messageKind(undefined)).toBe("unknown");
  });
});

describe("parseStamp", () => {
  it("turns ANAF's stamp into something sortable", () => {
    expect(parseStamp("202601151234")).toBe("2026-01-15T12:34");
  });

  it("keeps the seconds e-Transport's stamps carry", () => {
    expect(parseStamp("20221010144008")).toBe("2022-10-10T14:40:08");
  });

  it("stays zoneless, because ANAF never says which zone it means", () => {
    // Appending Z would move every timestamp; appending +02:00 would be wrong
    // for half the year.
    expect(parseStamp("202601151234")).not.toContain("Z");
    expect(parseStamp("202601151234")).not.toContain("+");
  });

  it("returns undefined rather than a wrong date", () => {
    expect(parseStamp("2026-01-15")).toBeUndefined();
    expect(parseStamp("")).toBeUndefined();
    expect(parseStamp(undefined)).toBeUndefined();
  });
});

describe("parseDetails", () => {
  it("lifts the ids out of the sentence they are buried in", () => {
    // The counterparty CIF is the field a ledger reconciles on, and leaving it
    // inside prose makes every consumer write this regex.
    expect(
      parseDetails(
        "Factura cu id_incarcare=5001234567 emisa de cif_emitent=92345672 pentru cif_beneficiar=87654329",
      ),
    ).toEqual({ uploadId: "5001234567", issuerCif: "92345672", beneficiaryCif: "87654329" });
  });

  it("fills only what the sentence actually carried", () => {
    expect(parseDetails("Erori de validare pentru id_incarcare=42")).toEqual({
      uploadId: "42",
      issuerCif: undefined,
      beneficiaryCif: undefined,
    });
    expect(parseDetails(undefined)).toEqual({
      uploadId: undefined,
      issuerCif: undefined,
      beneficiaryCif: undefined,
    });
  });
});

describe("invoiceMessage", () => {
  const raw = {
    data_creare: "202601151234",
    cif: "92345672",
    id_solicitare: "5001234567",
    detalii: "Factura cu id_incarcare=5001234567 emisa de cif_emitent=92345672 pentru cif_beneficiar=87654329",
    tip: "FACTURA PRIMITA",
    id: "3001234567",
  };

  it("keeps the download id distinct from the request id", () => {
    // download_invoice takes `id`. Handing it `id_solicitare` is a 200 with an
    // XML error document rather than an archive.
    const out = invoiceMessage(raw);
    expect(out.id).toBe("3001234567");
    expect(out.requestId).toBe("5001234567");
  });

  it("carries ANAF's own label beside the mapped kind", () => {
    const out = invoiceMessage(raw);
    expect(out.kind).toBe("received");
    expect(out.type).toBe("FACTURA PRIMITA");
  });

  it("survives a row with nothing in it", () => {
    expect(() => invoiceMessage({})).not.toThrow();
    expect(invoiceMessage({}).kind).toBe("unknown");
  });
});

describe("messageListing", () => {
  it("counts what it mapped", () => {
    const out = messageListing({ cui: "92345672", mesaje: [{ id: "1" }, { id: "2" }] });
    expect(out).toMatchObject({ count: 2 });
    expect(out.messages).toHaveLength(2);
  });

  it("does not echo cui, which carries a CNP on a real response", () => {
    // On a production answer, cui comes back as "<CNP>,<CIF>" (the certificate
    // holder's CNP). The caller already knows the CIF it asked for.
    // An invented CNP: month 00 is no one's birthday.
    const out = messageListing({ cui: "1000000000001,92345672", mesaje: [] });
    expect(JSON.stringify(out)).not.toContain("1000000000001");
  });

  it("surfaces an eroare instead of reporting it as no invoices", () => {
    // ANAF answers some refusals with HTTP 200 and this key. Mapping an absent
    // `mesaje` to [] would be the most expensive kind of wrong.
    const out = messageListing({ eroare: "Nu exista mesaje in perioada specificata" });
    expect(out.count).toBe(0);
    expect(out.notice).toContain("Nu exista mesaje");
  });

  it("carries the page counters through on the paginated listing", () => {
    expect(
      pagedMessageListing({ mesaje: [], index_pagina_curenta: 2, numar_total_pagini: 5, numar_total_inregistrari: 220 }),
    ).toMatchObject({ page: 2, totalPages: 5, totalRecords: 220 });
  });
});

describe("uploadReceipt", () => {
  it("reads the accepted case", () => {
    const out = uploadReceipt({ executionStatus: 0, indexIncarcare: 5001234567, dateResponse: "202601151234" }, "<raw/>");
    expect(out).toMatchObject({ accepted: true, uploadId: "5001234567", respondedAtLocal: "2026-01-15T12:34", errors: [] });
  });

  it("reads a refusal and every reason given for it", () => {
    const out = uploadReceipt(
      { executionStatus: 1, errors: [{ errorMessage: "CIF invalid" }, { errorMessage: "Lipsa linii" }, {}] },
      "<raw/>",
    );
    expect(out.accepted).toBe(false);
    expect(out.errors).toEqual(["CIF invalid", "Lipsa linii"]);
  });

  it("takes both the status and the id to call it accepted", () => {
    // A status-only check would call an answer without the id upload_status
    // needs accepted; an id-only check would call a future refusal that
    // echoes an id accepted.
    expect(uploadReceipt({ indexIncarcare: 1 }, "").accepted).toBe(false);
    expect(uploadReceipt({ executionStatus: 0 }, "").accepted).toBe(false);
  });

  it("keeps the document, whatever it made of it", () => {
    expect(uploadReceipt({}, "<anything/>").raw).toBe("<anything/>");
  });
});

describe("statusReceipt", () => {
  it("tells done from still-working from failed, per ANAF's published examples", () => {
    expect(statusReceipt({ stare: "ok", idDescarcare: "3001" }, "")).toMatchObject({ state: "ok", downloadId: "3001" });
    expect(statusReceipt({ stare: "in prelucrare" }, "").state).toBe("processing");
    expect(statusReceipt({ stare: "nok", idDescarcare: "123" }, "").state).toBe("failed");
    expect(statusReceipt({ stare: "XML cu erori nepreluat de sistem" }, "").state).toBe("failed");
    expect(statusReceipt({}, "").state).toBe("unknown");
  });

  it("keeps ANAF's word beside the mapped state, and its reasons", () => {
    const out = statusReceipt({ errors: [{ errorMessage: "Nu exista factura cu id_incarcare= 15000" }] }, "");
    expect(out).toMatchObject({ state: "unknown", stare: undefined, errors: ["Nu exista factura cu id_incarcare= 15000"] });
    expect(statusReceipt({ stare: "in prelucrare" }, "").stare).toBe("in prelucrare");
  });
});
