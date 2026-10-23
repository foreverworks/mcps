import { fail, inputError } from "../errors.js";
import { integerOf, leiOf, perCode, type Reading, totalOf } from "./reading.js";
import type { XmlElement } from "./xml.js";

/**
 * D112, the return of an employer's contributions and the tax it withholds
 * (structure `mfp:anaf:dgti:declaratie_unica:declaratie:v7`, "Anexa
 * validari" of 07.09.2026): the period `luna_r`/`an_r`, `d_rec` 1 on a
 * rectifying one, the employer `<angajator>` with `cif` (a CUI, or a CNP) and
 * `den`, and one `<angajatorA>` per obligation, whose `A_plata` (owed, less
 * deductible, less exempt) is what is to be paid. Here the employer's
 * `totalPlata_A` IS what is payable, the sum of every `A_plata` (the form's
 * own rule), so a file where the two differ is refused before anything runs.
 */
export const readD112 = (root: XmlElement, elements: readonly XmlElement[]): Reading => {
  const employer = elements.find((e) => e.name === "angajator") ?? fail(inputError("the D112 has no <angajator>"));
  const pay = elements.filter((e) => e.name === "angajatorA").map((r) => ({ code: r.attributes["A_codOblig"] ?? "?", lei: leiOf(r, "A_plata", "D112") }));
  const total = totalOf(pay.map((p) => p.lei));
  const declared = leiOf(employer, "totalPlata_A", "D112");
  if (declared !== total) fail(inputError(`the D112's totalPlata_A is ${declared}, but its obligations' A_plata add up to ${total}; the form requires them equal`));
  return {
    year: integerOf(root, "an_r", "D112", 2000, 2100),
    month: integerOf(root, "luna_r", "D112", 1, 12),
    cif: employer.attributes["cif"],
    name: employer.attributes["den"],
    rectifying: root.attributes["d_rec"] === "1",
    payable: { total, items: perCode(pay) },
  };
};
