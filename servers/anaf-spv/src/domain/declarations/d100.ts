import { integerOf, leiOf, perCode, type Reading, totalOf } from "./reading.js";
import type { XmlElement } from "./xml.js";

/**
 * D100, the return of what is owed to the state budget (structure
 * `mfp:anaf:dgti:d100:declaratie:v2`, "Anexa validari" of 14.09.2026): the
 * period `luna`/`an`, the taxpayer `cui` (a CUI, or a CNP) and `den`, and one
 * `<obligatie>` per obligation, whose `suma_plata` is what is to be paid and
 * `suma_rest` what is to be refunded. The root's `totalPlata_A` is a control
 * sum of every amount of every row, not what is payable. A D100 has no
 * rectifying flag: it is corrected by a D710.
 */
export const readD100 = (root: XmlElement, elements: readonly XmlElement[]): Reading => {
  const rows = elements.filter((e) => e.name === "obligatie");
  const pay = rows.map((r) => ({ code: r.attributes["cod_oblig"] ?? "?", lei: leiOf(r, "suma_plata", "D100") }));
  return {
    year: integerOf(root, "an", "D100", 2000, 2100),
    month: integerOf(root, "luna", "D100", 1, 12),
    cif: root.attributes["cui"],
    name: root.attributes["den"],
    rectifying: false,
    payable: {
      total: totalOf(pay.map((p) => p.lei)),
      items: perCode(pay),
      refundable: totalOf(rows.map((r) => leiOf(r, "suma_rest", "D100"))),
    },
  };
};
