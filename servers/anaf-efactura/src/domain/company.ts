import { compact, isIsoDate } from "@foreverworks/mcp-kit";

import { normaliseCif } from "./cif.js";
import { fail, inputError } from "./errors.js";
import type { RawCompany, RawCompanyList } from "./schema.js";

/** ANAF's cap per request (doc_WS_V9.txt, rule a). */
export const MAX_CIFS = 100;

/**
 * The CIFs to ask about: normalised (the RO prefix goes, as everywhere else),
 * written as the registry writes them back (a number, so no leading zeros),
 * each asked once, in the order given.
 */
export const parseCifs = (values: readonly string[]): readonly string[] => {
  const cifs = [...new Set(values.map(normaliseCif))];
  if (cifs.length === 0) return fail(inputError("give at least one CIF"));
  if (cifs.length > MAX_CIFS) return fail(inputError(`ANAF takes at most ${MAX_CIFS} CIFs in one request; got ${cifs.length}`));
  return cifs;
};

/**
 * The calendar date in Bucharest at `epochSeconds`. The registry answers "as of
 * a date", and a company's status changes at midnight Romanian time, not UTC.
 */
export const bucharestDate = (epochSeconds: number): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Bucharest", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(epochSeconds * 1000),
  );

/** The date to ask about: the caller's, or today in Bucharest. */
export const parseAsOf = (value: string, epochSeconds: number): string => {
  if (value === "") return bucharestDate(epochSeconds);
  if (!isIsoDate(value)) return fail(inputError(`"${value}" is not a YYYY-MM-DD date`));
  return value;
};

/** ANAF writes "none" as an empty string, or as null. */
const present = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? undefined : trimmed;
};

const orUndefined = <T extends object>(value: T): T | undefined => (Object.keys(value).length === 0 ? undefined : value);

/** The period with the latest start: the one that says whether, and since when, the company is a VAT payer. */
const latestVatPeriod = (raw: RawCompany) => {
  const periods = raw.inregistrare_scop_Tva?.perioade_TVA ?? [];
  const latest = [...periods].sort((a, b) => (present(b.data_inceput_ScpTVA) ?? "").localeCompare(present(a.data_inceput_ScpTVA) ?? ""))[0];
  return latest === undefined
    ? undefined
    : orUndefined(
        compact({
          from: present(latest.data_inceput_ScpTVA),
          to: present(latest.data_sfarsit_ScpTVA),
          reason: present(latest.mesaj_ScpTVA),
        }),
      );
};

/**
 * One company, in the words an invoice needs: who it is, where it is, and the
 * four statuses that change what an invoice to it must say (VAT payer, VAT on
 * collection, split VAT, inactive) plus whether it is in the RO e-Factura
 * registry. A status ANAF did not send stays absent rather than becoming false.
 */
export const companyOf = (raw: RawCompany) => {
  const g = raw.date_generale;
  const office = raw.adresa_sediu_social;
  const inactive = raw.stare_inactiv;
  return compact({
    cif: String(g.cui),
    name: present(g.denumire),
    asOf: present(g.data),
    tradeRegister: present(g.nrRegCom),
    registration: present(g.stare_inregistrare),
    registeredOn: present(g.data_inregistrare),
    legalForm: present(g.forma_juridica),
    caen: present(g.cod_CAEN),
    fiscalOffice: present(g.organFiscalCompetent),
    address: present(g.adresa),
    registeredOffice:
      office === undefined
        ? undefined
        : orUndefined(
            compact({
              street: present(office.sdenumire_Strada),
              number: present(office.snumar_Strada),
              details: present(office.sdetalii_Adresa),
              locality: present(office.sdenumire_Localitate),
              county: present(office.sdenumire_Judet),
              countyCode: present(office.scod_JudetAuto),
              postalCode: present(office.scod_Postal),
              country: present(office.stara),
            }),
          ),
    phone: present(g.telefon),
    vatPayer: raw.inregistrare_scop_Tva?.scpTVA ?? undefined,
    vatPeriod: latestVatPeriod(raw),
    vatOnCollection: raw.inregistrare_RTVAI?.statusTvaIncasare ?? undefined,
    splitVat: raw.inregistrare_SplitTVA?.statusSplitTVA ?? undefined,
    // The account split-VAT payments go to; ANAF publishes it for no other reason.
    iban: present(g.iban),
    inactive: inactive?.statusInactivi ?? undefined,
    inactiveSince: inactive?.statusInactivi === true ? present(inactive.dataInactivare) : undefined,
    deregisteredOn: present(inactive?.dataRadiere),
    eFacturaRegistry: g.statusRO_e_Factura ?? undefined,
    eFacturaRegistrySince: present(g.data_inreg_Reg_RO_e_Factura),
  });
};

export type Company = ReturnType<typeof companyOf>;

/** The answer, in the order the CIFs were asked, with the ones ANAF does not know named. */
export const companyListing = (raw: RawCompanyList, asked: readonly string[]) => {
  const byCif = new Map((raw.found ?? []).map((c) => [String(c.date_generale.cui), companyOf(c)]));
  return {
    companies: asked.flatMap((cif) => {
      const found = byCif.get(cif);
      return found === undefined ? [] : [found];
    }),
    notFound: asked.filter((cif) => !byCif.has(cif)),
  };
};
