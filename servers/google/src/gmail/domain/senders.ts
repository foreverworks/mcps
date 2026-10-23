/**
 * Who fills a mailbox: threads grouped by the sending domain and address, the
 * question every inbox clean-up starts from (which senders get a label, a
 * filter, or an unsubscribe). Pure.
 */
import { parseAddressList } from "./addresses.js";
import { headersOf } from "./mime.js";
import type { RawThread } from "./schema.js";

/** The one header a breakdown reads. */
export const SENDER_HEADERS = ["From"] as const;

export type ThreadSender = {
  /** Lower-cased; undefined when the From header held no address. */
  readonly email: string | undefined;
  readonly name: string | undefined;
  readonly unread: boolean;
  /** Epoch milliseconds of the thread's last message. */
  readonly at: number | undefined;
};

/**
 * A thread's sender is the author of its latest message that the mailbox did
 * not send itself: on a thread you answered last, "who writes to you" is still
 * the other side. A thread of only your own messages falls back to you.
 */
export const threadSender = (thread: RawThread): ThreadSender => {
  const messages = thread.messages ?? [];
  const received = messages.filter((m) => !(m.labelIds ?? []).includes("SENT"));
  const author = received.at(-1) ?? messages.at(-1);
  const address = parseAddressList(headersOf(author?.payload)["From"])[0];
  const at = Number(messages.at(-1)?.internalDate);
  return {
    email: address?.email.toLowerCase(),
    name: address?.name,
    unread: messages.some((m) => (m.labelIds ?? []).includes("UNREAD")),
    at: Number.isFinite(at) && at > 0 ? at : undefined,
  };
};

export type AddressRow = { readonly email: string; readonly name?: string; readonly threads: number; readonly unread: number };

export type DomainRow = {
  readonly domain: string;
  readonly threads: number;
  readonly unread: number;
  /** ISO dates of the newest and oldest thread, so a sender that went quiet years ago stands out. */
  readonly newest?: string;
  readonly oldest?: string;
  /** The busiest addresses under the domain, at most ADDRESSES_PER_DOMAIN. */
  readonly addresses: readonly AddressRow[];
};

export const ADDRESSES_PER_DOMAIN = 5;
const NO_ADDRESS = "(no address)";

const domainOf = (email: string | undefined): string => (email?.includes("@") ? (email.split("@").at(-1) as string) : NO_ADDRESS);

const iso = (ms: number | undefined): string | undefined => (ms === undefined ? undefined : new Date(ms).toISOString().slice(0, 10));

/** Map.groupBy, which this build's lib does not have yet. */
const groupBy = <T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return groups;
};

const byThreads = <T extends { readonly threads: number }>(a: T, b: T) => b.threads - a.threads;

const addressRows = (senders: readonly ThreadSender[]): readonly AddressRow[] => {
  const groups = groupBy(senders, (s) => s.email ?? NO_ADDRESS);
  return [...groups]
    .map(([email, list]) => {
      const name = list.find((s) => s.name)?.name;
      return { email, ...(name ? { name } : {}), threads: list.length, unread: list.filter((s) => s.unread).length };
    })
    .sort(byThreads)
    .slice(0, ADDRESSES_PER_DOMAIN);
};

const domainRow = (domain: string, senders: readonly ThreadSender[]): DomainRow => {
  const times = senders.flatMap((s) => (s.at === undefined ? [] : [s.at]));
  const newest = iso(times.length ? Math.max(...times) : undefined);
  const oldest = iso(times.length ? Math.min(...times) : undefined);
  return {
    domain,
    threads: senders.length,
    unread: senders.filter((s) => s.unread).length,
    ...(newest ? { newest } : {}),
    ...(oldest ? { oldest } : {}),
    addresses: addressRows(senders),
  };
};

/** The `top` busiest domains, and how much the rest add up to so nothing is silently left out. */
export const breakdown = (senders: readonly ThreadSender[], top: number) => {
  const rows = [...groupBy(senders, (s) => domainOf(s.email))].map(([domain, list]) => domainRow(domain, list)).sort(byThreads);
  const shown = rows.slice(0, top);
  const rest = rows.slice(top);
  return {
    threads: senders.length,
    unread: senders.filter((s) => s.unread).length,
    domainCount: rows.length,
    addressCount: new Set(senders.map((s) => s.email ?? NO_ADDRESS)).size,
    domains: shown,
    ...(rest.length
      ? { otherDomains: { domains: rest.length, threads: rest.reduce((n, r) => n + r.threads, 0), unread: rest.reduce((n, r) => n + r.unread, 0) } }
      : {}),
  };
};
