/**
 * The forms besides D212: what each one's XML says (the period, the taxpayer,
 * what it makes payable), which of ANAF's packages validates it, and the
 * line a person confirms. Every file in test/fixtures/declarations is
 * invented (a made-up CUI, name and amounts) and was checked on 2026-10-22
 * with ANAF's own DUKIntegrator (1.4.18.3.3) and the package
 * domain/declarations/kits.ts names for its period: "Validare fara erori",
 * and a filing PDF carrying it byte for byte.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { factsOf, filingLine, kitFor, pdfNameFor } from "../src/domain/declarations.js";
import { KITS } from "../src/domain/declarations/kits.js";
import { errorOf } from "./helpers.js";

export const fixture = (name: string): string => readFileSync(new URL(`./fixtures/declarations/${name}`, import.meta.url), "utf8");

const PDF = { name: "filing.pdf", size: 24282, sha256: "cd".repeat(32) };

describe("D100", () => {
  it("names its period, its taxpayer and what it makes payable, per obligation", () => {
    const facts = factsOf(fixture("d100.xml"), "D100");
    expect(facts).toEqual({
      form: "D100",
      year: 2026,
      month: 9,
      cif: "99999909",
      name: "EXEMPLU TEST SRL",
      namespace: "mfp:anaf:dgti:d100:declaratie:v2",
      rectifying: false,
      payable: { total: "1850", items: [{ code: "121", lei: "1250" }, { code: "150", lei: "600" }], refundable: "0" },
    });
    expect(pdfNameFor(facts, "ab".repeat(32))).toBe("D100_2026-09_abababababab.pdf");
  });

  it("sums what is to pay and to refund over rows, merging a code, and refuses an amount that is not whole lei", async () => {
    const rows = `<declaratie100 luna="3" an="2026" cui="99999909" den="X">
<obligatie cod_oblig="103" suma_plata="0" suma_rest="300"/><obligatie cod_oblig="121" suma_plata="999999999999999"/><obligatie cod_oblig="121" suma_plata="1"/></declaratie100>`;
    expect(factsOf(rows, "D100").payable).toEqual({ total: "1000000000000000", items: [{ code: "121", lei: "1000000000000000" }], refundable: "300" });
    expect((await errorOf(() => factsOf(rows.replace('suma_plata="1"', 'suma_plata="1.5"'), "D100")))?.message).toContain('suma_plata on <obligatie> is "1.5"');
    expect((await errorOf(() => factsOf(rows.replace('luna="3"', 'luna="13"'), "D100")))?.message).toContain("luna");
  });

  it("is validated with the package for its period, and a period before it is refused", async () => {
    expect(kitFor("D100", { year: 2026, month: 9 })).toBe(KITS.D100[0]);
    expect(kitFor("D100", { year: 2024, month: 1 }).zip).toBe("D100_14092026.zip");
    expect((await errorOf(() => kitFor("D100", { year: 2023, month: 12 })))?.message).toContain("for D100 for 2023-12; known: 2024-01 on");
  });

  it("is confirmed by one line naming the form, the period, the taxpayer and the amounts payable", () => {
    const line = filingLine(factsOf(fixture("d100.xml"), "D100"), PDF);
    expect(line).toBe(
      "File D100 for 09.2026 for 99999909 (EXEMPLU TEST SRL) at ANAF, to pay 1850 lei (121: 1250, 150: 600) (filing.pdf, 24282 bytes, sha256 cdcdcdcdcdcd); " +
        "a filed declaration cannot be withdrawn, only corrected by a D710",
    );
    expect(`anaf-spv: ${line}`.length).toBeLessThanOrEqual(300);
  });
});

describe("D300", () => {
  it("names its period and cadence, its taxpayer, the VAT to pay and the negative balance", () => {
    const facts = factsOf(fixture("d300.xml"), "D300");
    expect(facts).toEqual({
      form: "D300",
      year: 2026,
      month: 9,
      cif: "99999909",
      name: "EXEMPLU TEST SRL",
      namespace: "mfp:anaf:dgti:d300:declaratie:v12",
      rectifying: false,
      cadence: "monthly",
      payable: { total: "2100", items: [], refundable: "0", refundAsked: false },
    });
    expect(pdfNameFor(facts, "ab".repeat(32))).toBe("D300_2026-09_abababababab.pdf");
  });

  it("says when nothing is to pay and the balance is refunded or carried forward, and refuses an unknown cadence", async () => {
    // Not a fixture: the rows that matter, changed from the validated one.
    const refund = fixture("d300.xml").replace('tip_decont="L"', 'tip_decont="T"').replace('R41_2="2100"', 'R41_2="0" R42_2="7000"').replace('solicit_ramb="N"', 'solicit_ramb="D"');
    const facts = factsOf(refund, "D300");
    expect(filingLine(facts, PDF)).toBe(
      "File D300 for 09.2026 (quarterly) for 99999909 (EXEMPLU TEST SRL) at ANAF, no VAT to pay, negative VAT balance 7000 lei, refund asked " +
        "(filing.pdf, 24282 bytes, sha256 cdcdcdcdcdcd); a filed declaration cannot be withdrawn",
    );
    expect(filingLine(factsOf(refund.replace('solicit_ramb="D"', 'solicit_ramb="N"'), "D300"), PDF)).toContain("negative VAT balance 7000 lei, carried forward (");
    expect((await errorOf(() => factsOf(refund.replace('tip_decont="T"', 'tip_decont="X"'), "D300")))?.message).toContain("tip_decont");
  });

  it("is validated with the package for its period, from 05.2024", async () => {
    expect(kitFor("D300", { year: 2026, month: 9 }).zip).toBe("D300Validator_11022026_2.zip");
    expect((await errorOf(() => kitFor("D300", { year: 2024, month: 4 })))?.message).toContain("known: 2024-05 on");
  });

  it("is confirmed by one line naming the form, the period, the taxpayer and the VAT to pay", () => {
    const line = filingLine(factsOf(fixture("d300.xml"), "D300"), PDF);
    expect(line).toBe("File D300 for 09.2026 for 99999909 (EXEMPLU TEST SRL) at ANAF, VAT to pay 2100 lei (filing.pdf, 24282 bytes, sha256 cdcdcdcdcdcd); a filed declaration cannot be withdrawn");
    expect(`anaf-spv: ${line}`.length).toBeLessThanOrEqual(300);
  });
});

describe("D112", () => {
  it("names its period, the employer and what it makes payable, per obligation", () => {
    const facts = factsOf(fixture("d112.xml"), "D112");
    expect(facts).toEqual({
      form: "D112",
      year: 2026,
      month: 9,
      cif: "99999909",
      name: "EXEMPLU TEST SRL",
      namespace: "mfp:anaf:dgti:declaratie_unica:declaratie:v7",
      rectifying: false,
      payable: { total: "500", items: [{ code: "611", lei: "500" }] },
    });
    expect(pdfNameFor(facts, "ab".repeat(32))).toBe("D112_2026-09_abababababab.pdf");
  });

  it("sums every obligation, says a rectifying one, and refuses a total that is not their sum", async () => {
    // Not a fixture: the rows that matter, changed from the validated one.
    const two = fixture("d112.xml")
      .replace('totalPlata_A="500"', 'totalPlata_A="8300"')
      .replace('d_rec="0"', 'd_rec="1" tip_rec="2"')
      .replace("<angajatorA ", '<angajatorA A_codOblig="602" A_codBugetar="5503XXXXXX" A_datorat="7800" A_scutit="0" A_plata="7800"/>\n<angajatorA ');
    const facts = factsOf(two, "D112");
    expect(facts.payable).toEqual({ total: "8300", items: [{ code: "602", lei: "7800" }, { code: "611", lei: "500" }] });
    expect(filingLine(facts, PDF)).toBe(
      "File D112 (rectifying) for 09.2026 for 99999909 (EXEMPLU TEST SRL) at ANAF, to pay 8300 lei (602: 7800, 611: 500) (filing.pdf, 24282 bytes, sha256 cdcdcdcdcdcd); " +
        "a filed declaration cannot be withdrawn, only rectified",
    );
    expect((await errorOf(() => factsOf(two.replace('totalPlata_A="8300"', 'totalPlata_A="8000"'), "D112")))?.message).toContain("totalPlata_A is 8000, but its obligations' A_plata add up to 8300");
    expect((await errorOf(() => factsOf('<declaratieUnica luna_r="9" an_r="2026" d_rec="0"/>', "D112")))?.message).toContain("no <angajator>");
  });

  it("is validated with the package for its period, from 01.2025", async () => {
    expect(kitFor("D112", { year: 2026, month: 9 }).zip).toBe("D112_09102026.zip");
    expect((await errorOf(() => kitFor("D112", { year: 2024, month: 12 })))?.message).toContain("known: 2025-01 on");
  });

  it("is confirmed by one line naming the form, the period, the employer and the amounts payable", () => {
    const line = filingLine(factsOf(fixture("d112.xml"), "D112"), PDF);
    expect(line).toBe(
      "File D112 for 09.2026 for 99999909 (EXEMPLU TEST SRL) at ANAF, to pay 500 lei (611: 500) (filing.pdf, 24282 bytes, sha256 cdcdcdcdcdcd); a filed declaration cannot be withdrawn, only rectified",
    );
    expect(`anaf-spv: ${line}`.length).toBeLessThanOrEqual(300);
  });
});

describe("the README's table of ANAF's packages", () => {
  const periods = (form: string, from: string, until: string | undefined) =>
    form === "D212" ? `reporting year ${from.slice(0, 4)}` : `${from.slice(5)}.${from.slice(0, 4)}${until === undefined ? " on" : ` to ${until.slice(5)}.${until.slice(0, 4)}`}`;
  const table = Object.entries(KITS)
    .flatMap(([form, kits]) =>
      kits.map((k: { zip: string; from: string; until?: string; version?: string; published: string; basis?: string }) =>
        `| ${form} | \`${k.zip}\` | ${periods(form, k.from, k.until)} | ${k.version ?? ""} | ${k.published} | ${k.basis ?? ""} |`.replace(/ {2}\|/g, " |"),
      ),
    )
    .join("\n");

  it("is domain/declarations/kits.ts, row for row: the one place a new version goes", () => {
    const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
    const block = /<!-- kits:begin -->\n\| Form[^\n]*\n\|[-| ]+\|\n([\s\S]*?)\n<!-- kits:end -->/.exec(readme)?.[1];
    expect(block, `the README's block between <!-- kits:begin --> and <!-- kits:end --> should hold:\n${table}`).toBe(table);
  });
});
