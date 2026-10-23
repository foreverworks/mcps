import { addDays, daysBetween, isIsoDate } from "@foreverworks/mcp-kit";

/**
 * Calendar days, in the zone the bank books in.
 *
 * A card row carries a local booking DATE and no time, so an order has to be
 * placed on a local date before the two can be compared. An order at 00:30 in
 * Bucharest is 21:30 UTC the previous day: a local date and a UTC date are
 * different facts, and each is named for what it is.
 *
 * The zone is configuration (each server's `<PREFIX>_TIME_ZONE`, read by the
 * kit's timeZoneOf), so it arrives here as an argument: this module stays pure.
 */

export type LocalMoment = { readonly date: string; readonly time: string };

/** One formatter per zone: building one costs far more than using it, and a server only ever has one zone. */
const formats = new Map<string, Intl.DateTimeFormat>();

const formatIn = (timeZone: string): Intl.DateTimeFormat => {
  const known = formats.get(timeZone);
  if (known !== undefined) return known;
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formats.set(timeZone, format);
  return format;
};

/** An instant (epoch MILLISECONDS) as a date and time in `timeZone` (an IANA name). */
export const localMoment = (epochMs: number, timeZone: string): LocalMoment => {
  const parts = Object.fromEntries(formatIn(timeZone).formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  return { date: `${parts["year"]}-${parts["month"]}-${parts["day"]}`, time: `${parts["hour"]}:${parts["minute"]}` };
};

export const utcDate = (epochMs: number): string => new Date(epochMs).toISOString().slice(0, 10);

/**
 * Pure calendar arithmetic comes from the kit: once a date is a date, no zone
 * is involved in comparing two of them or counting the days between.
 */
export { addDays, daysBetween, isIsoDate };
