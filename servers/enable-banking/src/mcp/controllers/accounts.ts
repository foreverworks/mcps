import { z } from "zod";

import { getBalances, listAccounts, listStoredSessions } from "../../app/usecases/accounts.js";
import { exportTransactions, getTransactions, type StatementArgs } from "../../app/usecases/transactions.js";
import { handled } from "../envelope.js";
import type { Registrar } from "./types.js";

/** What get_transactions and export_transactions both take: which accounts, which dates, which rows. */
const STATEMENT_INPUT = {
  account_uid: z.string().optional().describe("One account: the uid field from list_accounts (a UUID, not the IBAN). Leave out to read every account on a consent."),
  label: z.string().optional().describe("Every account on this stored consent (a label from list_stored_sessions). Leave out, with account_uid, to read every stored consent."),
  date_from: z.string().default("").describe("YYYY-MM-DD, inclusive."),
  date_to: z.string().default("").describe("YYYY-MM-DD, inclusive."),
  transaction_status: z.string().default("booked"),
  text: z.string().optional().describe("Keep rows whose counterparty name or IBAN, payment reference or entry reference contains this; case and diacritics ignored."),
  direction: z.enum(["credit", "debit"]).optional().describe("credit: money in; debit: money out."),
  amount_min: z.string().optional().describe('Keep rows of at least this size, sign ignored, as a plain decimal such as "250" or "1200.50".'),
  amount_max: z.string().optional().describe("Keep rows of at most this size, sign ignored."),
};

type StatementInput = {
  account_uid?: string | undefined;
  label?: string | undefined;
  date_from: string;
  date_to: string;
  transaction_status: string;
  text?: string | undefined;
  direction?: "credit" | "debit" | undefined;
  amount_min?: string | undefined;
  amount_max?: string | undefined;
};

const statementArgs = (a: StatementInput): StatementArgs => ({
  accountUid: a.account_uid,
  label: a.label,
  dateFrom: a.date_from,
  dateTo: a.date_to,
  status: a.transaction_status,
  filter: { text: a.text, direction: a.direction, amount_min: a.amount_min, amount_max: a.amount_max },
});

export const registerAccounts: Registrar = (server, deps) => {
  server.registerTool(
    "list_stored_sessions",
    {
      title: "List stored consents",
      description:
        "Every stored consent: its label, the bank, the accounts it covered, and when it EXPIRES (date and " +
        "days left). A lapsed consent needs the account holder to approve a new one in the bank app, so check this first " +
        "when a statement suddenly fails, and before one runs out.",
      inputSchema: {},
    },
    handled(() => listStoredSessions(deps)),
  );

  server.registerTool(
    "list_accounts",
    {
      title: "List accounts on a consent",
      description:
        "The accounts a stored consent currently reaches, asked of the API rather than replayed from " +
        "disk, because a bank can drop an account from a live consent. The uid field is what " +
        "get_transactions takes.",
      inputSchema: {
        label: z.string().optional().describe("A label from list_stored_sessions; may be left out when only one consent is stored."),
      },
    },
    handled((args: { label?: string | undefined }) => listAccounts(deps, args)),
  );

  server.registerTool(
    "get_transactions",
    {
      title: "Get transactions",
      description:
        "A statement: the transactions of one account (account_uid), of every account on one consent (label), " +
        "or of every account on every stored consent (neither), following the bank's pagination to the end. " +
        "Each account read spends one of the few reads the bank allows per account per day (about four), so " +
        "read once and narrow with the filters rather than reading again: text, direction, amount_min and " +
        "amount_max run here, after the read, and cost nothing more.\n\n" +
        "Dates are YYYY-MM-DD and empty means unbounded. transaction_status takes a friendly name (booked, " +
        "pending, cancelled, hold, other, rejected, scheduled) or a PSD2 code; empty omits the filter, which is " +
        "NOT the same as asking for booked.\n\n" +
        "Each row carries a SIGNED decimal amount as a string, negative for money leaving the account, and a " +
        "counterparty resolved against the direction rather than copied from one fixed field. Amounts are " +
        "strings because they are exact: parse them yourself if you need arithmetic. An amountWarning appears " +
        "only on a row whose figure could not be taken at face value. Reading several accounts, each row also " +
        "names its account, and one account that fails is reported in accounts without hiding the others. For " +
        "more rows than a reply should hold, export_transactions writes the same statement as CSV.",
      inputSchema: STATEMENT_INPUT,
    },
    handled((args: StatementInput) => getTransactions(deps, statementArgs(args))),
  );

  server.registerTool(
    "export_transactions",
    {
      title: "Export transactions as CSV",
      description:
        "The same statement as get_transactions (same arguments, same filters, same reads at the bank), written " +
        "as a CSV file instead of returned: one row per transaction with its account, dates, direction, signed " +
        "exact amount, currency, counterparty, payment reference and status. Returns the file's path, size and " +
        "SHA-256, and how many rows it holds. Use it for a long period or many accounts, or when the result is " +
        "meant for a spreadsheet or an accountant.",
      inputSchema: STATEMENT_INPUT,
    },
    handled((args: StatementInput) => exportTransactions(deps, statementArgs(args))),
  );

  server.registerTool(
    "get_balances",
    {
      title: "Get balances",
      description:
        "The balances the bank reports for one account uid: every type it sends (booked, available, interim, " +
        "and so on), each with the PSD2 code as sent and its meaning spelled out, a reference date where the bank " +
        "gives one, and the amount as an EXACT decimal string signed by the bank (negative when overdrawn). " +
        "One read at the bank per call, like a statement.",
      inputSchema: {
        account_uid: z.string().describe("The uid field from list_accounts (a UUID, not the IBAN)."),
      },
    },
    handled((args: { account_uid: string }) => getBalances(deps, { accountUid: args.account_uid })),
  );
};
