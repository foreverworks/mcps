import { fail, inputError } from "../errors.js";
import { integerOf, leiOf, type Payable, type Reading } from "./reading.js";
import type { XmlElement } from "./xml.js";

const CADENCE = { L: "monthly", T: "quarterly", S: "half-yearly", A: "yearly" } as const;

/**
 * D300, the VAT return (structure `mfp:anaf:dgti:d300:declaratie:v12`,
 * "Anexa validari" v12.0.0 of 10.02.2026): everything is an attribute of the
 * root. The period `luna`/`an` and `tip_decont` (L, T, S, A: monthly,
 * quarterly, half-yearly, yearly), the taxpayer `cui` (a CUI only) and `den`.
 * What it makes payable is `R41_2`, "Sold TVA de plata la sfarsitul perioadei
 * de raportare" (max(R37_2 - R40_2, 0)); `R42_2` is the negative VAT balance
 * (max(R40_2 - R37_2, 0)), refunded when `solicit_ramb` is D. The root's
 * `totalPlata_A` is a control sum of every row, not what is payable. A D300
 * has no rectifying flag.
 */
export const readD300 = (root: XmlElement): Reading => {
  const tip = root.attributes["tip_decont"] ?? "";
  const cadence = tip in CADENCE ? CADENCE[tip as keyof typeof CADENCE] : fail(inputError(`the D300's tip_decont is "${tip}", not L, T, S or A`));
  return {
    year: integerOf(root, "an", "D300", 2000, 2100),
    month: integerOf(root, "luna", "D300", 1, 12),
    cif: root.attributes["cui"],
    name: root.attributes["den"],
    rectifying: false,
    cadence,
    payable: {
      total: leiOf(root, "R41_2", "D300"),
      items: [],
      refundable: leiOf(root, "R42_2", "D300"),
      refundAsked: root.attributes["solicit_ramb"] === "D",
    },
  };
};

/** "VAT to pay 2100 lei", or "no VAT to pay, negative VAT balance 7000 lei, refund asked". */
export const vatText = (p: Payable): string => {
  const pay = p.total === "0" ? "no VAT to pay" : `VAT to pay ${p.total} lei`;
  return p.refundable === undefined || p.refundable === "0" ? pay : `${pay}, negative VAT balance ${p.refundable} lei${p.refundAsked === true ? ", refund asked" : ", carried forward"}`;
};
