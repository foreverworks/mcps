import { VENDOR_INSTRUCTION_PARTS, VENDOR_INSTRUCTIONS } from "../infra/vendor.js";
import { ALWAYS, TOOLSET_NAMES, type Toolset } from "./toolsets.js";

/**
 * What the server tells a client at initialize. With every toolset loaded it
 * is the vendor's own text, word for word. With some, the paragraph on
 * publishing a site comes only with hosting, and a last sentence names what is
 * loaded and what is not: the vendor's descriptions and this server's remedies
 * name tools of other toolsets (a purchase's funding paragraph names the
 * top-ups and the verification codes), and a model that knows they are absent
 * says so instead of looking for a way around.
 */
export const instructionsFor = (loaded: readonly Toolset[]): string => {
  const absent = TOOLSET_NAMES.filter((toolset) => !loaded.includes(toolset));
  if (absent.length === 0) return VENDOR_INSTRUCTIONS;
  return [
    VENDOR_INSTRUCTION_PARTS.general,
    ...(loaded.includes("hosting") ? [VENDOR_INSTRUCTION_PARTS.website] : []),
    `This server loads only the Porkbun toolsets ${loaded.join(", ")} (PORKBUN_TOOLSETS), with ${ALWAYS.join(", ")} always there. ` +
      `The tools of ${absent.join(", ")} are not on this server, even where a description or an error names one: ` +
      "when a request needs one, tell the user which toolset it takes.",
  ].join(" ");
};
