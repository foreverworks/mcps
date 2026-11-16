import { bucharestToday, edges, windowOf } from "../../domain/dates.js";
import { drift, fail } from "../../domain/errors.js";
import { collectAll } from "../../domain/paging.js";
import { plateKey } from "../../domain/purchase.js";
import { invoiceView, notificationView, statusView, tollView, vehicleView } from "../../domain/views.js";
import type { Deps } from "../ports.js";

/** Every car on the account, with its vignette: until when, how many days are left, and what a new one may cover. */
export const listVehicles = async (deps: Deps) => {
  const today = bucharestToday(deps.now());
  const { items, truncated } = await collectAll(deps.etoll.vehicles);
  return {
    ok: true as const,
    today,
    vehicles: items.map((v) => vehicleView(v, today)),
    ...(truncated ? { truncated: true as const } : {}),
  };
};

/** One page of the account's tolls (vignettes, bridge passes), newest first as eToll lists them. */
export const listTolls = async (deps: Deps, args: { readonly status?: string | undefined; readonly plate?: string | undefined; readonly cursor?: string | undefined; readonly size: number }) => {
  const today = bucharestToday(deps.now());
  const page = await deps.etoll.tolls({ status: args.status, plate: args.plate === undefined ? undefined : plateKey(args.plate) }, args.cursor, args.size);
  return { ok: true as const, tolls: page.items.map((t) => tollView(t, today)), next_cursor: page.nextCursor ?? null };
};

/** One page of the account's invoices in a window of Bucharest days (the last year by default). */
export const listInvoices = async (deps: Deps, args: { readonly from?: string | undefined; readonly to?: string | undefined; readonly page: number; readonly size: number }) => {
  const window = windowOf(args.from, args.to, deps.now() * 1000);
  const answer = await deps.etoll.invoices(edges(window), args.page, args.size);
  const p = answer.page ?? undefined;
  return {
    ok: true as const,
    from: window.from,
    to: window.to,
    invoices: (answer.invoices ?? []).map(invoiceView),
    page: args.page,
    ...(typeof p?.totalElements === "number" ? { total: p.totalElements, total_is_lower_bound: answer.countIsLowerBound === true } : {}),
    ...(typeof p?.last === "boolean" ? { last: p.last } : {}),
  };
};

const PDF_MAGIC = "%PDF-";

const fileSafe = (id: string): string => id.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);

/** An invoice's PDF, saved in the outbox; the answer is its path, SHA-256 and size. */
export const downloadInvoice = async (deps: Deps, args: { readonly invoiceId: string }) => {
  const bytes = await deps.etoll.invoicePdf(args.invoiceId);
  if (new TextDecoder().decode(bytes.subarray(0, PDF_MAGIC.length)) !== PDF_MAGIC) {
    return fail(drift(`invoices/${args.invoiceId}/pdf answered ${bytes.length} bytes that are not a PDF`));
  }
  const saved = await deps.outbox.save(`etoll-invoice-${fileSafe(args.invoiceId)}.pdf`, bytes);
  return { ok: true as const, invoice_id: args.invoiceId, ...saved };
};

/** What eToll has told the account (a vignette about to end, a payment), and how many are unread. */
export const notifications = async (deps: Deps) => {
  const [list, unread] = await Promise.all([deps.etoll.notifications(), deps.etoll.unreadNotifications()]);
  return { ok: true as const, ...(unread === undefined ? {} : { unread }), notifications: list.map(notificationView) };
};

/** CNAIR's public status page for eToll: no account needed. */
export const serviceStatus = async (deps: Deps) => {
  const [components, incidents, schedules] = await Promise.all([deps.status.components(), deps.status.incidents(), deps.status.schedules()]);
  return { ok: true as const, ...statusView(components, incidents, schedules) };
};
