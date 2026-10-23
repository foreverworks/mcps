import { makeErrorKit } from "@foreverworks/mcp-kit";

import type { Cap } from "./charges.js";

/**
 * The ways a call fails here, as tagged data.
 *
 * The vendor's tools throw plain `Error`s with prose; `infra/vendorErrors.ts`
 * sorts that prose into these kinds once, at the boundary, so a caller reads a
 * `kind` (and Porkbun's own `code` when it sent one) instead of parsing text.
 */
export type AppError =
  /** No usable API keys, or no outbox for a tool that saves a file: nothing was sent. */
  | { readonly kind: "config"; readonly message: string; readonly variable?: typeof OUTBOX_VARIABLE }
  /** The arguments failed this server's own check (a DS digest of the wrong length, a DKIM key that is no key): nothing was sent. */
  | { readonly kind: "input"; readonly message: string }
  /** Porkbun answered in a shape this server does not know: a field it reads is missing. */
  | { readonly kind: "drift"; readonly message: string }
  /** A certificate bundle that does not hold together (its private key is not the certificate's): nothing was saved. */
  | { readonly kind: "bad_bundle"; readonly message: string }
  /**
   * The call would charge more than is left of one of the account's monthly API caps, as Porkbun reported them
   * just before: nothing was sent. `code` is what Porkbun would have answered; the figures are exact US dollars.
   */
  | {
      readonly kind: "over_limit";
      readonly message: string;
      readonly code: string;
      readonly cap: Cap;
      readonly figures: { readonly currency: "USD"; readonly charge: string; readonly limit: string; readonly used: string; readonly remaining: string; readonly source: string };
    }
  /** Porkbun answered and refused. `code` is Porkbun's machine code (`INSUFFICIENT_FUNDS`), when it sent one. */
  | { readonly kind: "api"; readonly message: string; readonly code?: string; readonly status?: number }
  /** The vendor's tool refused the arguments itself (two amounts that disagree, an unknown docs topic). */
  | { readonly kind: "refused"; readonly message: string }
  /** Porkbun could not be reached. */
  | { readonly kind: "network"; readonly message: string }
  /** The process may not reach that host (MCP_EGRESS_ALLOW). */
  | { readonly kind: "egress"; readonly message: string };

export const { fail, asAppError } = makeErrorKit<AppError>("porkbun");

/** The directory this server saves files into (a certificate and its key, invoice PDFs); the only place it writes. */
export const OUTBOX_VARIABLE = "PORKBUN_OUTBOX_DIR";

export const inputError = (message: string): AppError => ({ kind: "input", message });

/** Porkbun's code for a purchase the balance cannot cover; its message carries the shortfall. */
const INSUFFICIENT_FUNDS = "INSUFFICIENT_FUNDS";

/** What to do about it, in one sentence. */
export const remedyFor = (error: AppError): string => {
  switch (error.kind) {
    case "config":
      return error.variable === OUTBOX_VARIABLE
        ? `set ${OUTBOX_VARIABLE} to a directory this server may write and its callers may read (a group); certificates, their keys and generated mailbox passwords (mode 0640) and invoice PDFs are saved there`
        : "give the server the key pair made at https://porkbun.com/account/api: PORKBUN_API_KEY_FILE and PORKBUN_SECRET_API_KEY_FILE " +
            "naming a file each, or PORKBUN_API_KEY and PORKBUN_SECRET_API_KEY for a local stdio run";
    case "input":
      return "fix what the message names and call again; nothing was sent to Porkbun";
    case "drift":
      return "Porkbun answered in a shape this server does not read; compare the pinned @porkbunllc/mcp-server with the API's documentation (read_doc)";
    case "bad_bundle":
      return "Porkbun's certificate bundle does not hold together and nothing was saved; try again later, and if it persists download it at porkbun.com (Domain Management, SSL) and check it";
    case "over_limit":
      return error.cap === "spend"
        ? "only the account holder can raise the monthly API spend limit, at https://porkbun.com/account/api; until then buy something cheaper, or wait for the next calendar month"
        : "only the account holder can raise the monthly API top-up limit, at https://porkbun.com/account/api; until then top up a smaller amount, or add credit at https://porkbun.com/account/credit";
    case "api":
      return error.code === INSUFFICIENT_FUNDS
        ? "account credit is short by the shortfall in the message: top_up_account_credit (a money tool: the client asks the user) or credit at https://porkbun.com/account/credit, then repeat the same call"
        : "Porkbun refused the call; its message, and the `next:` hint when there is one, says what to change";
    case "refused":
      return "the tool refused these arguments; the message says which one to change";
    case "network":
      return "Porkbun was unreachable; retry in a minute";
    case "egress":
      return "this server may reach only the hosts in MCP_EGRESS_ALLOW (api.porkbun.com, porkbun.com); a vendor version that calls another host needs that list widened";
  }
};
