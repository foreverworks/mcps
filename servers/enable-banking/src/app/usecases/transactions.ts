import { csvOf } from "@foreverworks/mcp-kit";

import { parseAccountUid } from "../../domain/accounts.js";
import { parseRange } from "../../domain/dates.js";
import { asAppError, fail, inputError, notFound, remedyFor, type AppError } from "../../domain/errors.js";
import { applyFilter, parseFilter, type FilterArgs, type TransactionFilter } from "../../domain/filters.js";
import type { StoredAccount } from "../../domain/sessions.js";
import { parseStatus } from "../../domain/status.js";
import { transaction, type Transaction } from "../../domain/transactions.js";
import type { Deps } from "../ports.js";
import { NOT_STORED, requireSession, storedAccount } from "./accounts.js";

/**
 * Statements: one account, or every account a consent (or every consent)
 * reaches, narrowed by filters that run here, after the read.
 *
 * Every account read is one of the bank's few unattended reads for that
 * account that day (PSD2 allows about four), and the bank charges it whether
 * or not a row matches. So the reads happen one account at a time, an account
 * that fails does not sink the others, and the answer always says what was read.
 */

export type StatementArgs = {
  readonly accountUid?: string | undefined;
  readonly label?: string | undefined;
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly status: string;
  readonly filter: FilterArgs;
};

type Target = { readonly accountUid: string; readonly label?: string | undefined; readonly stored?: StoredAccount | undefined };

type Read =
  | (Target & { readonly ok: true; readonly rows: readonly Transaction[] })
  | (Target & { readonly ok: false; readonly error: AppError });

type Plan = {
  readonly single: boolean;
  readonly scope: string;
  readonly range: { readonly from?: string; readonly to?: string };
  readonly status: string | undefined;
  readonly filter: TransactionFilter | undefined;
  readonly targets: readonly Target[];
};

/** Everything is checked before the first read, so a typo costs nothing at the bank. */
const plan = async (deps: Deps, args: StatementArgs): Promise<Plan> => {
  const range = parseRange(args.dateFrom, args.dateTo);
  const status = parseStatus(args.status);
  const filter = parseFilter(args.filter);
  if (args.accountUid !== undefined && args.label !== undefined) {
    return fail(inputError("pass account_uid for one account, or label for every account on one consent, not both"));
  }
  if (args.accountUid !== undefined) {
    const accountUid = parseAccountUid(args.accountUid);
    const found = await storedAccount(deps, accountUid);
    const target: Target = found === undefined ? { accountUid } : { accountUid, label: found.label, stored: found };
    return { single: true, scope: `account-${accountUid.slice(0, 8)}`, range, status, filter, targets: [target] };
  }
  const sessions = args.label === undefined ? (await deps.sessions.read()).sessions : [await requireSession(deps, args.label)];
  const targets = sessions.flatMap((s) => s.accounts.map((a) => ({ accountUid: a.uid, label: s.label, stored: a })));
  if (targets.length === 0) {
    return fail(notFound(args.label === undefined ? "no consent is stored yet; run start_auth, then complete_auth" : `the consent "${args.label}" lists no accounts; list_accounts asks the bank what it reaches now`));
  }
  return { single: false, scope: args.label ?? "all", range, status, filter, targets };
};

const readOne = async (deps: Deps, p: Plan, target: Target): Promise<Read> => {
  try {
    const rows = await deps.bank.getTransactions({ accountUid: target.accountUid, ...p.range, ...(p.status === undefined ? {} : { status: p.status }) });
    return { ...target, ok: true, rows: rows.map(transaction) };
  } catch (thrown) {
    const error = asAppError(thrown);
    // A bug is not an account that could not be read: let it surface as one.
    if (error === undefined) throw thrown;
    return { ...target, ok: false, error };
  }
};

/** One account after another: banks throttle bursts, and nothing here is in a hurry. */
const readAll = async (deps: Deps, p: Plan): Promise<readonly Read[]> => {
  const reads: Read[] = [];
  for (const target of p.targets) reads.push(await readOne(deps, p, target));
  // When nothing could be read there is no statement to give: the first failure is the answer.
  const failed = reads.filter((r): r is Extract<Read, { ok: false }> => !r.ok);
  const first = failed[0];
  if (first !== undefined && failed.length === reads.length) fail(first.error);
  return reads;
};

/** The filters as applied, and what they left out, only when some were asked for. */
const narrowed = <Row extends Transaction>(filter: TransactionFilter | undefined, rows: readonly Row[]) => {
  if (filter === undefined) return { rows, report: {} };
  const { kept, amountUnreadable } = applyFilter(filter, rows);
  return {
    rows: kept,
    report: {
      filters: filter,
      fetched: rows.length,
      ...(amountUnreadable === 0 ? {} : { amountUnreadable, amountUnreadableNote: "rows whose amount could not be read exactly, left out because they cannot be compared with amount_min or amount_max" }),
    },
  };
};

/** What was asked of the bank, echoed as SENT: a blank date_to is null, not today, which would read as a bound applied. */
const asked = (p: Plan) => ({ dateFrom: p.range.from ?? null, dateTo: p.range.to ?? null, transactionStatus: p.status ?? null });

const accountLine = (r: Read) => ({
  accountUid: r.accountUid,
  ...(r.label === undefined ? {} : { label: r.label }),
  ...(r.stored?.iban === undefined ? {} : { iban: r.stored.iban }),
  ...(r.stored?.currency === undefined ? {} : { currency: r.stored.currency }),
  ...(r.stored?.name === undefined ? {} : { name: r.stored.name }),
  ...(r.ok ? { read: r.rows.length } : { error: { ...r.error, remedy: remedyFor(r.error) } }),
});

/** Each row says which account it came from, once there can be more than one. */
const tagged = (reads: readonly Read[]) =>
  reads.flatMap((r) => (r.ok ? r.rows.map((row) => ({ ...row, accountUid: r.accountUid, ...(r.stored?.iban === undefined ? {} : { accountIban: r.stored.iban }) })) : []));

export const getTransactions = async (deps: Deps, args: StatementArgs) => {
  const p = await plan(deps, args);
  const reads = await readAll(deps, p);

  if (p.single) {
    const [only] = reads;
    if (only === undefined || !only.ok) return fail(inputError("no account was read"));
    const { rows, report } = narrowed(p.filter, only.rows);
    return {
      ok: true,
      accountUid: only.accountUid,
      account: only.stored === undefined ? NOT_STORED : { label: only.label, ...only.stored },
      ...asked(p),
      ...report,
      count: rows.length,
      transactions: rows,
    };
  }

  const failed = reads.filter((r) => !r.ok).length;
  const { rows, report } = narrowed(p.filter, tagged(reads));
  return {
    ok: true,
    scope: args.label === undefined ? "every stored consent" : `consent ${args.label}`,
    ...asked(p),
    ...report,
    accountsRead: reads.length - failed,
    ...(failed === 0 ? {} : { accountsFailed: failed }),
    accounts: reads.map(accountLine),
    count: rows.length,
    transactions: rows,
  };
};

/** The CSV's columns, in the order an accountant reads a statement. */
const COLUMNS = [
  "account_label",
  "account_iban",
  "booking_date",
  "value_date",
  "direction",
  "amount",
  "currency",
  "counterparty_name",
  "counterparty_iban",
  "remittance",
  "reference",
  "status",
  "bank_code",
  "merchant_category_code",
  "amount_warning",
] as const;

type CsvRow = Readonly<Record<(typeof COLUMNS)[number], string | undefined>>;

const csvRow = (labelOf: (uid: string) => string | undefined) => (row: Transaction & { readonly accountUid: string; readonly accountIban?: string | undefined }): CsvRow => ({
  account_label: labelOf(row.accountUid),
  account_iban: row.accountIban,
  booking_date: row.bookingDate,
  value_date: row.valueDate,
  direction: row.direction,
  amount: row.amount,
  currency: row.currency,
  counterparty_name: row.counterpartyName,
  counterparty_iban: row.counterpartyIban,
  remittance: row.remittance,
  reference: row.reference,
  status: row.status,
  bank_code: row.bankCode,
  merchant_category_code: row.merchantCategoryCode,
  amount_warning: row.amountWarning,
});

/**
 * The same statement, written as CSV into the exports folder instead of into
 * the conversation: a year of a busy account is thousands of rows, which a
 * spreadsheet holds better than a context window.
 */
export const exportTransactions = async (deps: Deps, args: StatementArgs) => {
  const p = await plan(deps, args);
  const reads = await readAll(deps, p);
  const { rows, report } = narrowed(p.filter, tagged(reads));
  const labels = new Map(reads.map((r) => [r.accountUid, r.label]));
  // Named for the scope, the range AND the moment, so a second export never replaces a file someone has open.
  const at = new Date(deps.now() * 1000).toISOString().replace(/[:.]/g, "-");
  const name = `transactions-${p.scope}-${p.range.from ?? "start"}-${p.range.to ?? "latest"}-${at}.csv`;
  const written = await deps.files.writeText(deps.paths.exportsDir, name, csvOf(COLUMNS, rows.map(csvRow((uid) => labels.get(uid)))));
  const failed = reads.filter((r) => !r.ok).length;
  return {
    ok: true,
    ...written,
    rows: rows.length,
    ...asked(p),
    ...report,
    accountsRead: reads.length - failed,
    ...(failed === 0 ? {} : { accountsFailed: failed }),
    accounts: reads.map(accountLine),
  };
};
