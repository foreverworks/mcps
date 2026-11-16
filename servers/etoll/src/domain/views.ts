import { daysBetween } from "@foreverworks/mcp-kit";

import { localDateOf } from "./dates.js";
import { priceView } from "./money.js";
import type { ComponentsWire, IncidentsWire, InvoiceWire, NotificationWire, SchedulesWire, TollWire, VehicleWire } from "./schema.js";

/**
 * What a tool answers, built from the wire shapes: the fields an agent asks
 * about, named once, snake_case like every answer here, dates as Bucharest
 * calendar days. Pure.
 */

/** The vignette durations eToll sells, by its codes, in the words a person uses. */
export const DURATIONS: Readonly<Record<string, string>> = {
  ONE_DAY: "1 day",
  TEN_DAYS: "10 days",
  THIRTY_DAYS: "30 days",
  SIXTY_DAYS: "60 days",
  TWELVE_MONTHS: "12 months",
};

export const durationLabel = (code: string | null | undefined): string | null => (code ? (DURATIONS[code] ?? code) : null);

/** What a toll is: the portal's enum, as its number or its name. */
const KINDS = ["vignette", "bridge", "route", "per_km"] as const;

export const kindOf = (type: string | number | null | undefined): string | null => {
  if (typeof type === "number") return KINDS[type] ?? String(type);
  if (typeof type === "string" && type !== "") return /^\d+$/.test(type) ? (KINDS[Number(type)] ?? type) : type.toLowerCase();
  return null;
};

/**
 * The periods eToll says a new vignette may cover, less those already over:
 * eToll keeps listing a gap before a vignette bought today, e.g. yesterday
 * alone (seen live 2026-11-15).
 */
export const eligiblePeriods = (v: VehicleWire, today: string): readonly { readonly from: string | null; readonly to: string | null }[] =>
  (v.vignetteEligibility?.eligibleIntervals ?? [])
    .map((i) => ({ from: localDateOf(i.start) ?? null, to: localDateOf(i.end) ?? null }))
    .filter((p) => p.to === null || p.to >= today);

export const vehicleView = (v: VehicleWire, today: string) => {
  const eligibility = v.vignetteEligibility ?? undefined;
  const until = localDateOf(eligibility?.expirationDateCurrentVignette);
  const periods = eligiblePeriods(v, today);
  return {
    id: v.id,
    plate: v.plateNumber ?? null,
    country: v.countryCode ?? null,
    category: v.category ?? null,
    vehicle_type: v.vehicleType ?? null,
    vin: v.vin ?? null,
    emission_standard: v.emissionStandard ?? null,
    vignette:
      until === undefined
        ? null
        : { valid_until: until, days_left: daysBetween(today, until), active: until >= today },
    // eToll's own verdict on what a new vignette may cover; null when it did not compute one.
    eligible: eligibility === undefined ? null : periods.length > 0,
    eligible_periods: eligibility === undefined ? null : periods,
  };
};

export type VehicleView = ReturnType<typeof vehicleView>;

export const tollView = (t: TollWire, today: string) => {
  const from = localDateOf(t.validFrom) ?? null;
  const until = localDateOf(t.validUntil) ?? null;
  return {
    id: t.id,
    kind: kindOf(t.type),
    status: t.status ?? null,
    plate: t.vehicle?.plateNumber ?? null,
    country: t.vehicle?.countryCode ?? null,
    category: t.vehicle?.category ?? null,
    duration: durationLabel(t.duration),
    valid_from: from,
    valid_until: until,
    days_left: until === null || until < today ? null : daysBetween(today, until),
    price: priceView(t.price, `toll ${t.id}'s price`),
    serial: t.issuance?.serialNo ?? null,
    route: t.routeDescription ?? null,
    bridge: t.bridgeType ?? null,
    refundable: t.refundable ?? null,
  };
};

export const invoiceView = (i: InvoiceWire) => {
  const total = priceView(i.total, `invoice ${i.id}'s total`);
  const number = i.externalNumberStr ?? (i.externalNumber === null || i.externalNumber === undefined ? null : String(i.externalNumber));
  return {
    id: i.id,
    series: i.externalSeries ?? null,
    number,
    paid_at: i.paymentDate ?? null,
    payment_method: i.paymentMethod ?? null,
    buyer: i.buyerName ?? null,
    for: i.types ?? null,
    total: total?.total ?? null,
    vat: total?.vat ?? null,
    currency: total?.currency ?? null,
  };
};

export const notificationView = (n: NotificationWire) => ({
  id: n.id ?? null,
  at: n.createdAt ?? null,
  type: n.type ?? null,
  text: n.description ?? null,
  plate: n.vehiclePlateNumber ?? null,
  unread: n.isActive ?? null,
});

/** Cachet's numbers: 1 operational, 2 slower, 3 partial outage, 4 major outage. */
const COMPONENT = ["unknown", "operational", "performance_issues", "partial_outage", "major_outage"] as const;
/** An incident is open until it reaches 4 (fixed); maintenance is planned (0), under way (1) or done (2). */
const FIXED = 4;
const DONE = 2;

export const statusView = (components: ComponentsWire, incidents: IncidentsWire, schedules: SchedulesWire) => ({
  components: [...components.data]
    .filter((c) => c.attributes.enabled !== false)
    .sort((a, b) => (a.attributes.order ?? 0) - (b.attributes.order ?? 0))
    .map((c) => ({
      name: c.attributes.name ?? null,
      status: COMPONENT[c.attributes.status?.value ?? 0] ?? String(c.attributes.status?.value),
      status_text: c.attributes.status?.human ?? null,
      updated: c.attributes.updated?.string ?? null,
    })),
  open_incidents: incidents.data
    .filter((i) => (i.attributes.status?.value ?? FIXED) !== FIXED)
    .map((i) => ({ name: i.attributes.name?.trim() ?? null, message: i.attributes.message ?? null, status_text: i.attributes.status?.human ?? null, since: i.attributes.occurred?.string ?? null })),
  maintenance: schedules.data
    .filter((s) => (s.attributes.status?.value ?? DONE) !== DONE)
    .map((s) => ({ name: s.attributes.name ?? null, message: s.attributes.message ?? null, status_text: s.attributes.status?.human ?? null, from: s.attributes.scheduled?.string ?? null, to: s.attributes.completed?.string ?? null })),
});
