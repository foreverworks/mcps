/**
 * A host name as DNS spells it (RFC 1123): labels of letters, digits and
 * hyphens, 1 to 63 characters, not starting or ending with a hyphen, 253 in
 * all. Syntax only: nothing here asks DNS whether the name exists. Pure.
 */

const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const MAX_LABEL = 63;
const MAX_NAME = 253;

/** Lower case, without the root's trailing dot: the form a registry compares. */
export const normalHostname = (name: string): string => name.trim().toLowerCase().replace(/\.$/, "");

/** What is wrong with a fully qualified host name, or undefined when nothing is. */
export const hostnameProblem = (name: string): string | undefined => {
  const host = normalHostname(name);
  if (host === "") return "a host name is empty";
  if (host.length > MAX_NAME) return `"${name}" is longer than ${MAX_NAME} characters`;
  const labels = host.split(".");
  if (labels.length < 2) return `"${name}" is not a fully qualified host name (e.g. ns1.example.com)`;
  const bad = labels.find((label) => label.length > MAX_LABEL || !LABEL.test(label));
  if (bad !== undefined) {
    return `"${name}" has the label "${bad}", which is not 1 to ${MAX_LABEL} letters, digits or hyphens (not starting or ending with a hyphen)`;
  }
  if (/^\d+$/.test(labels[labels.length - 1] ?? "")) return `"${name}" is an IP address, not a host name`;
  return undefined;
};
