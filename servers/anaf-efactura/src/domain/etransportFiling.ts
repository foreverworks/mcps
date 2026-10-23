import { cnp, compare, parseDecimal, romanianCif, sum, toDecimal, formatDecimal, ZERO } from "@foreverworks/mcp-kit";

import { all, at, attribute, isElement, one, type XmlElement, type XmlValue } from "./xmlTree.js";

/**
 * A transport declaration for ANAF's e-Transport (etransport_file), read from
 * the XML that will be filed: what it does, to which UIT, along which route,
 * in which vehicle, for goods worth how much. The schema is ANAF's v2
 * (schema_ETR_v2_20230126.xsd, namespace mfp:anaf:dgti:eTransport:declaratie:v2):
 * one root, `eTransport`, holding exactly one of
 *
 * - `notificare`: a new transport, or, with a `corectie` inside, the
 *   correction of the one its UIT names;
 * - `stergere`: the deletion of a UIT;
 * - `confirmare`: the receiver's confirmation of a UIT (10 confirmed, 20 in
 *   part, 30 not confirmed);
 * - `modifVehicul`: a change of vehicle on a UIT.
 *
 * Values stay the text the file holds; the goods' value is the exact sum of
 * the lines' `valoareLeiFaraTva`, never a float.
 */

export type Operation = "declaration" | "correction" | "deletion" | "confirmation" | "vehicle change";

export type Place =
  | { readonly kind: "address"; readonly county: string | undefined; readonly locality: string | undefined; readonly street: string | undefined }
  | { readonly kind: "border crossing"; readonly code: string }
  | { readonly kind: "customs office"; readonly code: string };

export type Vehicle = { readonly plate: string | undefined; readonly trailer1: string | undefined; readonly trailer2: string | undefined };

export type TransportDeclaration = {
  readonly operation: Operation;
  /** The declarant's CIF or CNP (BT-1), digits. */
  readonly declarant: string | undefined;
  readonly reference: string | undefined;
  /** The UIT a correction, deletion, confirmation or vehicle change is for; undefined for a new declaration. */
  readonly uit: string | undefined;
  /** BT-4: 10 intra-EU acquisition, 20 intra-EU supply, 30 national, 40 import, 50 export, ... */
  readonly operationType: string | undefined;
  /** 10 confirmed, 20 confirmed in part, 30 not confirmed. */
  readonly confirmation: string | undefined;
  readonly from: Place | undefined;
  readonly to: Place | undefined;
  readonly vehicle: Vehicle | undefined;
  readonly transportDate: string | undefined;
  readonly partner: { readonly country: string | undefined; readonly code: string | undefined; readonly name: string | undefined } | undefined;
  readonly carrier: { readonly country: string | undefined; readonly code: string | undefined; readonly name: string | undefined } | undefined;
  readonly goods: {
    readonly lines: number;
    /** How many lines state their value in RON without VAT. */
    readonly valued: number;
    /** The sum of those values, exactly; undefined when no line states one. */
    readonly valueRon: string | undefined;
  };
  /** Filed after an outage of RO e-Transport (declPostAvarie D). */
  readonly afterOutage: boolean;
};

export type DeclarationReading = { readonly kind: "declaration"; readonly declaration: TransportDeclaration } | { readonly kind: "unreadable"; readonly why: string };

const OPERATIONS = ["notificare", "stergere", "confirmare", "modifVehicul"] as const;

const place = (node: XmlValue | undefined): Place | undefined => {
  if (!isElement(one(node))) return undefined;
  const border = attribute(node, "codPtf");
  if (border !== undefined) return { kind: "border crossing", code: border };
  const customs = attribute(node, "codBirouVamal");
  if (customs !== undefined) return { kind: "customs office", code: customs };
  const where = at(node, "locatie");
  return { kind: "address", county: attribute(where, "codJudet"), locality: attribute(where, "denumireLocalitate"), street: attribute(where, "denumireStrada") };
};

const vehicleOf = (node: XmlValue | undefined): Vehicle | undefined =>
  isElement(one(node)) ? { plate: attribute(node, "nrVehicul"), trailer1: attribute(node, "nrRemorca1"), trailer2: attribute(node, "nrRemorca2") } : undefined;

const goodsOf = (lines: readonly XmlValue[]): TransportDeclaration["goods"] => {
  const values = lines.map((l) => attribute(l, "valoareLeiFaraTva")).filter((v): v is string => v !== undefined && parseDecimal(v) !== undefined);
  return { lines: lines.length, valued: values.length, valueRon: values.length === 0 ? undefined : formatDecimal(sum(values.map(toDecimal))) };
};

export const readDeclaration = (tree: XmlElement): DeclarationReading => {
  const root = tree["eTransport"];
  if (!isElement(one(root))) {
    const roots = Object.keys(tree).filter((k) => !k.startsWith("?") && !k.startsWith("@_"));
    return { kind: "unreadable", why: `root element ${roots[0] ?? "(none)"} is not eTransport` };
  }
  const present = OPERATIONS.filter((name) => at(root, name) !== undefined);
  if (present.length !== 1) return { kind: "unreadable", why: `an eTransport holds exactly one of ${OPERATIONS.join(", ")}; this one holds ${present.length === 0 ? "none" : present.join(" and ")}` };
  const [name] = present as [(typeof OPERATIONS)[number]];
  const body = at(root, name);
  const common = {
    declarant: attribute(root, "codDeclarant")?.trim(),
    reference: attribute(root, "refDeclarant"),
    afterOutage: attribute(root, "declPostAvarie") === "D",
  };
  const none = { operationType: undefined, confirmation: undefined, from: undefined, to: undefined, vehicle: undefined, transportDate: undefined, partner: undefined, carrier: undefined, goods: { lines: 0, valued: 0, valueRon: undefined } };
  if (name === "notificare") {
    const correction = attribute(at(body, "corectie"), "uit");
    const transport = at(body, "dateTransport");
    const partner = at(body, "partenerComercial");
    return {
      kind: "declaration",
      declaration: {
        ...common,
        operation: correction === undefined ? "declaration" : "correction",
        uit: correction,
        operationType: attribute(body, "codTipOperatiune"),
        confirmation: undefined,
        from: place(at(body, "locStartTraseuRutier")),
        to: place(at(body, "locFinalTraseuRutier")),
        vehicle: vehicleOf(transport),
        transportDate: attribute(transport, "dataTransport"),
        partner: isElement(one(partner)) ? { country: attribute(partner, "codTara"), code: attribute(partner, "cod"), name: attribute(partner, "denumire") } : undefined,
        carrier: isElement(one(transport))
          ? { country: attribute(transport, "codTaraOrgTransport"), code: attribute(transport, "codOrgTransport"), name: attribute(transport, "denumireOrgTransport") }
          : undefined,
        goods: goodsOf(all(at(body, "bunuriTransportate"))),
      },
    };
  }
  const uit = attribute(body, "uit");
  if (name === "stergere") return { kind: "declaration", declaration: { ...common, ...none, operation: "deletion", uit } };
  if (name === "confirmare") return { kind: "declaration", declaration: { ...common, ...none, operation: "confirmation", uit, confirmation: attribute(body, "tipConfirmare") } };
  return {
    kind: "declaration",
    declaration: { ...common, ...none, operation: "vehicle change", uit, vehicle: vehicleOf(body), transportDate: attribute(body, "dataModificare") },
  };
};

// --- what would be refused ------------------------------------------------------

/**
 * A UIT's own check (ANAF's schematron, BR-019): sixteen characters, the last
 * two the last two digits of the sum of the first fourteen's code points.
 * ANAF's sample 8H0Q0V0L0Q3WQN41: the fourteen sum to 941.
 */
export const uitProblem = (uit: string): string | undefined => {
  if (!/^[0-9ACDEFHJKLMNPQRTUVWXY]{14}[0-9]{2}$/.test(uit)) return `UIT ${uit} is not sixteen characters of a UIT's alphabet`;
  const total = [...uit.slice(0, 14)].reduce((s, c) => s + (c.codePointAt(0) ?? 0), 0);
  // A sum: a wrong character shows, two characters swapped do not (ANAF's own check is the same).
  return String(total).slice(-2) === uit.slice(14) ? undefined : `UIT ${uit} fails its check digits (a character is wrong)`;
};

/** The declarant's code: a CIF by its control digit, or a person's 13-digit CNP by its own (BR-002 takes both). */
const declarantProblem = (code: string | undefined): string | undefined => {
  if (code === undefined) return "the declaration names no declarant (codDeclarant)";
  if (/^[1-9]\d{12}$/.test(code)) return cnp(code).ok ? undefined : `the declarant's CNP ${code} fails its control digit`;
  const checked = romanianCif(code);
  return checked.ok && /^\d+$/.test(code) ? undefined : `the declarant's code ${code} is not a CIF (digits, no RO) that passes its control digit, nor a CNP`;
};

/** Why a declaration cannot be filed as it stands, found before anyone is asked to confirm it. */
export const declarationProblems = (d: TransportDeclaration): readonly string[] => [
  ...[declarantProblem(d.declarant)].filter((p): p is string => p !== undefined),
  ...(d.operation !== "declaration" && d.uit === undefined ? [`a ${d.operation} names the UIT it is for`] : []),
  ...(d.uit === undefined ? [] : [uitProblem(d.uit)].filter((p): p is string => p !== undefined)),
  ...(d.goods.valueRon !== undefined && compare(toDecimal(d.goods.valueRon), ZERO) < 0 ? ["the goods' value is negative"] : []),
];

// --- the line a person confirms -------------------------------------------------

export const SUMMARY_MAX = 300;

const clean = (value: string | undefined, max: number): string => {
  const flat = (value ?? "?").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return flat === "" ? "?" : flat.length > max ? `${flat.slice(0, max - 1)}~` : flat;
};

const placeText = (p: Place | undefined): string => {
  if (p === undefined) return "?";
  if (p.kind === "border crossing") return `border crossing ${clean(p.code, 6)}`;
  if (p.kind === "customs office") return `customs office ${clean(p.code, 8)}`;
  return `${clean(p.locality, 30)} (county ${clean(p.county, 3)})`;
};

const vehicleText = (v: Vehicle | undefined): string =>
  v === undefined ? "vehicle ?" : [`vehicle ${clean(v.plate, 20)}`, ...[v.trailer1, v.trailer2].filter((t): t is string => t !== undefined).map((t) => `trailer ${clean(t, 20)}`)].join(" + ");

const valueText = (g: TransportDeclaration["goods"]): string =>
  g.valueRon === undefined
    ? "no goods value stated"
    : `${g.valueRon} RON${g.valued < g.lines ? ` (${g.valued} of ${g.lines} lines valued)` : ""}`;

const CONFIRMATIONS: Readonly<Record<string, string>> = { "10": "confirmed", "20": "confirmed in part", "30": "not confirmed" };

export type FilingIntent = {
  readonly test: boolean;
  /** The `cif` argument; empty means app.json's. */
  readonly cif: string;
  readonly sha256?: string | undefined;
  readonly refile?: boolean | undefined;
};

/**
 * The ONE line a person confirms before a declaration is filed:
 * "File e-Transport <operation> for <UIT or new>, <route>, <vehicle>, <goods
 * value> RON, environment <test|prod>". A deletion and a confirmation carry no
 * route, vehicle or goods, and a vehicle change only its vehicle, so their
 * lines name what they do hold. The declarant and the file's sha256 follow.
 * A file that cannot be read says so in capitals: the answer to that is no.
 */
export const filingSummary = (reading: DeclarationReading, intent: FilingIntent): string => {
  const environment = `environment ${intent.test ? "test" : "prod"}`;
  const tail = [
    ...(reading.kind === "declaration" ? [`declarant ${clean(reading.declaration.declarant, 13)}`] : []),
    ...(intent.cif === "" ? [] : [`as CIF ${clean(intent.cif, 16)}`]),
    ...(intent.refile === true ? ["AGAIN (refile)"] : []),
    ...(intent.sha256 === undefined ? [] : [`file sha256 ${intent.sha256.slice(0, 12)}`]),
  ].join(", ");
  if (reading.kind === "unreadable") return `File e-Transport: UNREADABLE XML (${clean(reading.why, 120)}), nobody can say what this files, ${environment}; ${tail}`.slice(0, SUMMARY_MAX);
  const d = reading.declaration;
  const target = d.uit === undefined ? "a new UIT" : `UIT ${clean(d.uit, 16)}`;
  const what =
    d.operation === "declaration" || d.operation === "correction"
      ? [`File e-Transport ${d.operation} for ${target}`, `${placeText(d.from)} to ${placeText(d.to)}`, vehicleText(d.vehicle), valueText(d.goods)]
      : d.operation === "vehicle change"
        ? [`File e-Transport vehicle change for ${target}`, vehicleText(d.vehicle), `from ${clean(d.transportDate, 19)}`]
        : d.operation === "confirmation"
          ? [`File e-Transport confirmation (${CONFIRMATIONS[d.confirmation ?? ""] ?? `type ${clean(d.confirmation, 4)}`}) for ${target}`]
          : [`File e-Transport deletion for ${target}`];
  return `${[...what, environment].join(", ")}; ${tail}`.slice(0, SUMMARY_MAX);
};
