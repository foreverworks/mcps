/**
 * A filing's number and ANAF's status page, read. The pages are
 * test/fixtures/stare: `none.html` and `refused.html` are stare.anaf.ro's own
 * answers of 2026-10-22 to an invented index and tax id (1999999901 and
 * 99999909; "abc" for the refusal), byte for byte in the page's ISO-8859-1;
 * `found.html` is written in the shape of a listing (anafpy's capture of
 * 2026-07-16, docs/anaf-reference/_sources/stared112/result-found.html) with
 * invented filings only.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { filingRefOf, isoDateOf, registrationIn, stateOf, taxIdOf } from "../src/domain/status.js";
import { stareAnswerIn } from "../src/infra/stare.js";
import { errorOf } from "./helpers.js";

const page = (name: string) => new TextDecoder("latin1").decode(readFileSync(new URL(`./fixtures/stare/${name}`, import.meta.url)));

describe("a filing's number", () => {
  it("is an index or a registration number, which carries the index and the year", async () => {
    expect(filingRefOf(" 1200000002 ")).toEqual({ index: "1200000002", year: undefined });
    expect(filingRefOf("INTERNT-1200000002-2026")).toEqual({ index: "1200000002", year: 2026 });
    expect(filingRefOf("internt-1200000002-2026/12-10-2026")).toEqual({ index: "1200000002", year: 2026 });
    expect(filingRefOf("INTERNT-200000003-2020 din 16-11-2020")).toEqual({ index: "200000003", year: 2020 });
    expect((await errorOf(() => filingRefOf("D212 2023")))?.kind).toBe("input");
    expect(registrationIn("recipisa pentru CIF 2990101999999, tip D212, numar_inregistrare INTERNT-1200000001-2026/12-10-2026, perioada raportare 12.2025")).toEqual({
      index: "1200000001",
      year: 2026,
      number: "INTERNT-1200000001-2026",
    });
    expect(registrationIn("depunere declaratie unica")).toBeUndefined();
  });

  it("goes with a CNP or a CUI, without RO", async () => {
    expect(taxIdOf("RO 99999909")).toBe("99999909");
    expect(taxIdOf("2990101999999")).toBe("2990101999999");
    expect((await errorOf(() => taxIdOf("299010199999")))?.kind).toBe("input");
    expect(isoDateOf("24.09.2026")).toBe("2026-09-24");
    expect(isoDateOf("2026-09-24")).toBe("2026-09-24");
  });
});

describe("ANAF's status page", () => {
  it("lists a tax id's filings with their state, registration and receipt link", () => {
    const answer = stareAnswerIn(page("found.html"));
    expect(answer).toMatchObject({ kind: "rows", cif: "99999909", from: "22.07.2026", to: "22.10.2026" });
    if (answer.kind !== "rows") return;
    expect(answer.rows).toEqual([
      { index: "1300000003", document: "D300", state: "In prelucrare.", registered: "INTERNT-1300000003-2026 din 21.10.2026", uploaded: "2026-10-21", receiptLinked: true },
      { index: "1300000002", document: "D100", state: "Documentul este valid", registered: "INTERNT-1300000002-2026 din 24.09.2026", uploaded: "2026-09-24", receiptLinked: true },
      { index: "1300000001", document: "D112", state: "Fişierul depus nu este un document valid.", registered: "INTERNT-1300000001-2026 din 20.08.2026", uploaded: "2026-08-20", receiptLinked: true },
      { index: "1290000009", document: "D112", state: "Documentul are erori de validare.", registered: "INTERNT-1290000009-2026 din 23.07.2026", uploaded: "2026-07-23", receiptLinked: false },
    ]);
    expect(answer.rows.map((r) => stateOf(r.state))).toEqual(["processing", "valid", "not_registered", "validation_errors"]);
    expect(stateOf("Ceva nou")).toBe("unknown");
  });

  it("reads its own answers to an unknown index and to one that is not digits, and nothing else", async () => {
    expect(stareAnswerIn(page("none.html"))).toEqual({ kind: "none" });
    expect(stareAnswerIn(page("refused.html"))).toEqual({ kind: "refused", message: "Nu ati introdus un index valid" });
    expect((await errorOf(() => stareAnswerIn("<html><body>Service Unavailable</body></html>")))?.kind).toBe("drift");
  });
});
