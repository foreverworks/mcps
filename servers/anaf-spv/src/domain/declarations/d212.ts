import { integerOf, type Reading } from "./reading.js";
import type { XmlElement } from "./xml.js";

/**
 * D212, the declaratie unica a person files for a year: the reporting year
 * `an_r`, the CNP `cif`, `rectif1`/`rectif2` set on a rectifying one. What it
 * makes payable is spread over its chapters and is not read here.
 */
export const readD212 = (root: XmlElement): Reading => {
  const rectif = root.attributes["rectif1"] ?? root.attributes["rectif2"] ?? "";
  return {
    year: integerOf(root, "an_r", "D212", 2000, 2100),
    month: 12,
    cif: root.attributes["cif"],
    name: undefined,
    rectifying: rectif !== "" && rectif !== "0",
    payable: undefined,
  };
};
