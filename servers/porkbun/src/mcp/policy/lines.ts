import type { ToolArgs } from "@foreverworks/mcp-kit";

import { centsArg, usd } from "../../domain/cents.js";

/**
 * The pieces of the one line a user confirms. They read the arguments the
 * vendor's tool validated, and never throw: a line that cannot be built would
 * leave the user nothing to read.
 */

const text = (value: unknown): string | undefined => (typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined);

const record = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined;

/** The domain as the vendor sends it (lower case). */
export const domainOf = (args: ToolArgs): string => text(args["domain"])?.toLowerCase() ?? "(no domain given)";

/** Said first, so a rehearsal reads as one at a glance. */
export const dryRunPrefix = (args: ToolArgs): string => (args["dry_run"] === true ? "DRY RUN, no charge: " : "");

/**
 * An amount as the vendor will read it: the `_cents` argument or its legacy
 * alias, in dollars. Two that disagree are refused by the vendor before
 * anything is sent, and the line says so rather than picking one.
 */
export const dollars = (args: ToolArgs, name: string, legacy: string, whenAbsent: string): string => {
  const arg = centsArg(args, name, legacy);
  switch (arg.kind) {
    case "cents":
      return usd(arg.cents);
    case "absent":
      return whenAbsent;
    case "conflict":
      return `CONFLICTING ${name} and ${legacy} (the call will be refused)`;
  }
};

export const given = (args: ToolArgs, name: string, legacy: string): boolean => centsArg(args, name, legacy).kind !== "absent";

/** Who a contact is: name, organisation, email. */
const person = (value: unknown): string => {
  const contact = record(value);
  if (contact === undefined) return "(unreadable contact)";
  const name = [text(contact["firstName"]), text(contact["lastName"])].filter((part) => part !== undefined).join(" ");
  const organization = text(contact["organization"]);
  const email = text(contact["email"]);
  return `${name}${organization === undefined ? "" : ` (${organization})`}${email === undefined ? "" : ` <${email}>`}`;
};

/** Which contacts change, and who the registrant becomes when it is one of them. */
export const contactsChange = (args: ToolArgs): string => {
  const single = args["contact"];
  const perRole = record(args["contacts"]);
  const roles = single !== undefined ? "all four contacts" : perRole === undefined ? "no contacts" : `the ${Object.keys(perRole).join(", ")} contact(s)`;
  const registrant = single ?? perRole?.["registrant"];
  return `change ${roles} of ${domainOf(args)}${registrant === undefined ? "" : `; the registrant, the owner of record, becomes ${person(registrant)}`}`;
};

/** A webhook's subscription: the events, or all of them. */
export const events = (args: ToolArgs): string => {
  const list = args["events"];
  return Array.isArray(list) && list.length > 0 ? list.map(String).join(", ") : "all events";
};

/**
 * How a purchase is paid, as the vendor reads its arguments: a card payment
 * already authorised (`card_payment_id`), the user's card through Stripe
 * Link (`pay_with_card`, which first answers with a link to pay), or account
 * credit.
 */
export const fundedBy = (args: ToolArgs): string => {
  const authorised = text(args["card_payment_id"]);
  if (authorised !== undefined) return `with card payment ${authorised}, already authorised in Stripe Link (charged only if it succeeds)`;
  return args["pay_with_card"] === true ? "by the user's card through Stripe Link (a link to pay first; held, charged only if it succeeds)" : FROM_CREDIT;
};

export const FROM_CREDIT = "from Porkbun account credit";

/** A mailbox as the vendor names it: the whole address, or the part before the @ on the domain, or its id. */
export const mailboxOf = (args: ToolArgs): string => {
  const address = text(args["address"]);
  if (address !== undefined) return address.includes("@") ? address : `${address}@${domainOf(args)}`;
  return typeof args["mailbox_id"] === "number" ? `mailbox #${String(args["mailbox_id"])} on ${domainOf(args)}` : `(no mailbox named) on ${domainOf(args)}`;
};

/** Whose password a new mailbox gets: Porkbun's generated one, saved in the outbox, or the one given (never shown). */
export const mailboxPassword = (args: ToolArgs): string =>
  text(args["password"]) === undefined ? "Porkbun generates its password, saved in this server's outbox" : "with the password given in the call";

/** A mailbox's DNS: the call may replace the domain's other MX records and rewrite its SPF only when told to. */
export const mailDns = (args: ToolArgs): string =>
  args["confirm_dns_changes"] === true ? "; REPLACES the domain's other MX records and rewrites its SPF as the earlier answer described" : "";
