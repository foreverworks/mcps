import { TOOLSET_NAMES, type Toolset } from "./toolsets.js";

/** What every deployment is told, with every toolset loaded. */
export const FULL_INSTRUCTIONS =
  "Trademark registers: whether a name is already a registered or pending mark. search_marks checks one name across offices, " +
  "optionally by Nice class; get_mark, mark_history and mark_documents read one mark in depth. Each office answers for itself, and " +
  "one that could not be searched says why: never read that as clear. health says which sources work.";

const SEARCH_INSTRUCTIONS =
  "Trademark registers: whether a name is already a registered or pending mark. search_marks checks one name across offices, " +
  "optionally by Nice class; get_mark reads one mark in depth. Each office answers for itself, and " +
  "one that could not be searched says why: never read that as clear. health says which sources work. " +
  "A mark's status history and documents are not on this server.";

/**
 * What the server tells a client at initialize: the text every deployment has
 * always had with every toolset, and without the `records` toolset the same
 * with the tools that are not there left out, so a model does not look for them.
 */
export const instructionsFor = (loaded: readonly Toolset[]): string =>
  TOOLSET_NAMES.every((toolset) => loaded.includes(toolset)) ? FULL_INSTRUCTIONS : loaded.includes("records") ? FULL_INSTRUCTIONS : SEARCH_INSTRUCTIONS;
