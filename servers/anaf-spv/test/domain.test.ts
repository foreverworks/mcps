import { describe, expect, it } from "vitest";

import { codesIn, firstNewCode, typedCode } from "../src/domain/codes.js";
import { dateAt, dayStart, isoAt, portalInstant } from "../src/domain/dates.js";
import { fileNameFor, keyed, matches, type Message, type MessageRow, ownIds, safeName, servedNameFits } from "../src/domain/messages.js";
import { alertLine } from "../src/domain/alerts.js";
import { attachmentName, plainText } from "../src/domain/contact.js";
import { cuiOnlyAmong, fieldsFor, ruleFor, saysCuiOnly } from "../src/domain/requests.js";
import { errorOf } from "./helpers.js";

describe("Bucharest times", () => {
  it("reads SPV's wall-clock times on both sides of the DST changes", () => {
    expect(isoAt(portalInstant("15.07.2026 10:00:00") ?? 0)).toBe("2026-07-15T10:00:00+03:00");
    expect(isoAt(portalInstant("15.12.2026 10:00:00") ?? 0)).toBe("2026-12-15T10:00:00+02:00");
    // 25 October 2026, 04:00 summer time becomes 03:00 winter time: 03:30 happens twice; 05:00 is winter.
    expect(isoAt(portalInstant("25.10.2026 05:00:00") ?? 0)).toBe("2026-10-25T05:00:00+02:00");
    expect(isoAt(portalInstant("29.03.2026 05:00:00") ?? 0)).toBe("2026-03-29T05:00:00+03:00");
    expect(portalInstant("15.01.2021")).toBe(Date.UTC(2021, 0, 14, 22, 0, 0));
  });

  it("refuses what is not a date", () => {
    expect(portalInstant("31.02.2026 10:00:00")).toBeUndefined();
    expect(portalInstant("2026-07-15")).toBeUndefined();
    expect(portalInstant("")).toBeUndefined();
  });

  it("counts calendar days in Bucharest, not UTC", () => {
    expect(dateAt(Date.UTC(2026, 9, 11, 22, 30))).toBe("2026-10-12");
    expect(dayStart("2026-10-12")).toBe(Date.UTC(2026, 9, 11, 21, 0, 0));
  });
});

const row = (over: Partial<MessageRow> = {}): MessageRow => ({
  cif: "2990101999999",
  type: "DECIZIE",
  requestId: undefined,
  postedAtMs: portalInstant("15.07.2026 10:00:00") ?? 0,
  archivedAtMs: portalInstant("15.09.2026 10:00:00"),
  details: "Decizii de calcul accesorii PF",
  ...over,
});

describe("messages", () => {
  it("names a row by what it shows, the same in every listing", () => {
    const [a] = keyed([row()]);
    const [b] = keyed([row({ type: "PLATA" }), row()]).slice(1);
    expect(a?.key).toMatch(/^[0-9a-f]{16}$/);
    expect(b?.key).toBe(a?.key);
  });

  it("numbers rows that show exactly the same thing", () => {
    const keys = keyed([row(), row(), row()]).map((m) => m.key);
    expect(new Set(keys).size).toBe(3);
    expect(keys[1]).toBe(`${keys[0]}-2`);
  });

  it("selects by type and words without case or diacritics, and by Bucharest dates", () => {
    const [m] = keyed([row({ details: "Decizie de impunere din oficiu, anul 2024" })]);
    if (m === undefined) throw new Error("no message");
    expect(matches({ type: "decizie" })(m)).toBe(true);
    expect(matches({ text: "IMPUNERE din" })(m)).toBe(true);
    expect(matches({ since: "2026-07-15", until: "2026-07-15" })(m)).toBe(true);
    expect(matches({ since: "2026-07-16" })(m)).toBe(false);
    expect(matches({ until: "2026-07-14" })(m)).toBe(false);
  });

  it("names a saved file by date, type and SPV's own name, and never lets that name climb out", () => {
    const [m] = keyed([row({ type: "RASPUNS SOLICITARE" })]);
    if (m === undefined) throw new Error("no message");
    expect(fileNameFor(m, "190000004_D212.pdf")).toBe("2026-07-15_raspuns-solicitare_190000004_D212.pdf");
    expect(safeName("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(safeName("")).toBe("document.pdf");
  });
});

describe("security codes", () => {
  it("finds every code, with or without diacritics, in order", () => {
    const text = 'Cod de siguranta: 246810, expira dupa 300 secunde.\n{"snippet":"Cod de siguranță: 135791, expira"}\nCod de siguranta: 246810';
    expect(codesIn(text)).toEqual(["246810", "135791"]);
    expect(codesIn("Your code is 123456")).toEqual([]);
  });

  it("takes the first code that was not there before", () => {
    expect(firstNewCode(["135791", "246810"], new Set(["246810"]))).toBe("135791");
    expect(firstNewCode(["246810"], new Set(["246810"]))).toBeUndefined();
  });

  it("keeps only the digits a person typed", () => {
    expect(typedCode(" 246 810 ")).toBe("246810");
    expect(typedCode("24-68-10")).toBe("246810");
    expect(typedCode("abc123")).toBeUndefined();
  });
});

describe("request fields", () => {
  it("follows SPV's form script, type by type", () => {
    expect(fieldsFor("Obligatii de plata", {})).toEqual({ year: "", month: undefined, registrationNumber: "", pui: "", monthFrom: undefined, monthTo: undefined });
    expect(fieldsFor("Duplicat declaratie unica", { year: 2025 })).toMatchObject({ year: "2025", month: undefined });
    expect(fieldsFor("Duplicat Recipisa", { registrationNumber: " INTERNT-1-2026 " })).toMatchObject({ registrationNumber: "INTERNT-1-2026" });
    expect(fieldsFor("Neconcordante D394", { year: 2024 })).toMatchObject({ monthFrom: "1", monthTo: "12", month: undefined });
    expect(fieldsFor("Certificat", { year: 2026, month: 9 })).toMatchObject({ year: "2026", month: "9" });
    expect(fieldsFor("Certificat", {})).toMatchObject({ year: "", month: "" });
    expect(ruleFor("bilant SEMESTRIAL").fixedMonth).toBe(6);
  });

  it("names what is missing or not taken", async () => {
    expect((await errorOf(() => fieldsFor("Duplicat Recipisa", {})))?.message).toContain("needs registration_number");
    expect((await errorOf(() => fieldsFor("Istoric declaratii PF", { month: 3 })))?.message).toContain("takes no fields; drop month");
    expect((await errorOf(() => fieldsFor("Duplicat declaratie unica", { year: 2025, month: 12 })))?.message).toContain("only year");
  });
});

describe("whether a served file is the message's own", () => {
  const CIF = "2990101999999";
  const row = (r: Partial<MessageRow>): MessageRow => ({ cif: CIF, type: "RASPUNS SOLICITARE", requestId: undefined, postedAtMs: 0, archivedAtMs: undefined, details: "", ...r });
  const listing = keyed([
    row({ requestId: "190000001", details: `Obligatii de plata pentru CNP ${CIF}` }),
    row({ requestId: "190000002", details: `duplicat Duplicat Recipisa pentru CIF ${CIF}` }),
    row({ type: "RASPUNS SESIZARE FORMULAR UNIC DE CONTACT", details: `Raspuns la formularul unic de contact cu numarul de inregistrare 50000012026/10.03.2026 pentru cif=${CIF}` }),
    row({ type: "RECIPISA", details: `recipisa pentru CIF ${CIF}, tip D212, numar_inregistrare INTERNT-1200000001-2026/20-05-2026, perioada raportare 12.2025` }),
    row({ type: "DECIZIE", details: `Decizii de calcul accesorii PF pentru CIF ${CIF}, prelucrata la 02-03-2026` }),
    row({ requestId: "190000003", details: `raport F2102_SPV pentru banca avand CUI=${CIF}` }),
  ]);
  const at = (i: number): Message => listing[i] ?? expect.unreachable(`no row ${i}`);
  const [answer, duplicate, contact, receipt, decision, report] = [at(0), at(1), at(2), at(3), at(4), at(5)] as const;

  it("knows a row's own ids, never the tax id", () => {
    expect(ownIds(answer)).toEqual(["190000001"]);
    expect(ownIds(contact)).toEqual(["50000012026"]);
    expect(ownIds(receipt)).toEqual(["1200000001"]);
    expect(ownIds(decision)).toEqual([]);
  });

  it("takes the names SPV gives each kind of document", () => {
    expect(servedNameFits(answer, "190000001_Obligatii_de_plata.pdf", listing)).toEqual({ ok: true });
    expect(servedNameFits(contact, "FormularUnic_50000012026.pdf", listing)).toEqual({ ok: true });
    expect(servedNameFits(receipt, "1200000001.pdf", listing)).toEqual({ ok: true });
    expect(servedNameFits(decision, "SV00000000002.pdf", listing)).toEqual({ ok: true });
    expect(servedNameFits(report, "F2102_SPV_ANAF_f2102.xml.pdf", listing)).toEqual({ ok: true });
  });

  it("refuses a name that carries another message's id, or a different id where the row has one", () => {
    const foreign = servedNameFits(duplicate, "190000001_Obligatii_de_plata.pdf", listing);
    expect(foreign).toMatchObject({ ok: false });
    expect(foreign.ok ? "" : foreign.reason).toContain("190000001, the id of another message (RASPUNS SOLICITARE 190000001)");
    expect(servedNameFits(decision, "190000002_Duplicat_Recipisa.pdf", listing)).toMatchObject({ ok: false });
    expect(servedNameFits(answer, "SV00000000002.pdf", listing)).toMatchObject({ ok: false });
    expect(servedNameFits(answer, "190000009_Obligatii_de_plata.pdf", listing)).toMatchObject({ ok: false });
  });
});

describe("a contact form message", () => {
  it("strips diacritics in both their forms and makes typographic marks plain", () => {
    expect(plainText("Mulţumesc, mulțumesc: „Șase” – ȚARĂ… îmi\r\npare\u00a0bine", 1500)).toBe('Multumesc, multumesc: "Sase" - TARA... imi\npare bine');
  });

  it("refuses what it cannot send whole", async () => {
    expect((await errorOf(() => plainText("x".repeat(11), 10)))?.message).toContain("11 characters");
    expect((await errorOf(() => plainText("   ", 10)))?.message).toBe("the text is empty");
    expect((await errorOf(() => plainText("2 × 3", 10)))?.message).toContain("×");
  });

  it("names an attachment as SPV takes it", async () => {
    expect(attachmentName("Cerere ștampilată (2).PDF")).toBe("Cerere_stampilata_2_.PDF");
    expect((await errorOf(() => attachmentName("cerere.docx")))?.kind).toBe("input");
    expect((await errorOf(() => attachmentName("cerere")))?.kind).toBe("input");
  });
});

describe("types made only for a company", () => {
  it("knows Notificare and reads SPV's refusal in either spelling", () => {
    expect(saysCuiOnly("Raportul Notificare se genereaza doar pentru un CUI")).toBe(true);
    expect(saysCuiOnly("Raportul X se generează doar pentru un CUI.")).toBe(true);
    expect(saysCuiOnly("Nu exista date pentru perioada selectata.")).toBe(false);
    expect(cuiOnlyAmong(["C168", "notificare"], {})).toEqual([{ type: "notificare", source: "known" }]);
    expect(cuiOnlyAmong(["Situatie Sintetica"], { "situatie sintetica": { type: "Situatie Sintetica", source: "learned", learnedAtMs: 1, spvSaid: "x" } })).toHaveLength(1);
  });
});

describe("a line of SPV's alert e-mail", () => {
  it("reads the document, its form and the day ANAF processed it", () => {
    expect(alertLine("- CIF 29901XXXXXXXX: Somatii si Titluri executorii PF pentru CIF 2990101999999, prelucrata la 16-03-2026")).toEqual({
      details: "Somatii si Titluri executorii PF pentru CIF 2990101999999, prelucrata la 16-03-2026",
      document: "Somatii si Titluri executorii PF",
      form: undefined,
      processedOn: "2026-03-16",
    });
    expect(alertLine("- CIF 29901XXXXXXXX: raport Plata_GhiseulRo pentru id=100000001 si cnp=2990101999999")?.document).toBe("raport Plata_GhiseulRo");
    expect(alertLine("- CIF 29901XXXXXXXX: Raspuns la formularul unic de contact cu numarul de inregistrare 50000000001/10.03.2026 pentru cif=2990101999999")?.document).toBe(
      "Raspuns la formularul unic de contact cu numarul de inregistrare 50000000001/10.03.2026",
    );
    expect(alertLine("Ați primit următoarele documente în Spațiul Privat Virtual (SPV) ANAF:")).toBeUndefined();
    expect(alertLine("Mesaj automat.")).toBeUndefined();
  });
});
