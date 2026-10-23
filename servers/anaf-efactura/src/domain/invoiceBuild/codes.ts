/**
 * The CIUS-RO code lists a built invoice is held to before ANAF sees it, from
 * ANAF's CIUS-RO rules (BR-RO-*) and EN 16931's code lists. ANAF's validator
 * stays the authority; these catch the common mistakes with a sentence that
 * says what to write instead.
 */

/** BT-24, pinned by BR-RO-001. */
export const CIUS_RO = "urn:cen.eu:en16931:2017#compliant#urn:efactura.mfinante.ro:CIUS-RO:1.0.1";

/** BT-3 on a UBL Invoice (BR-RO-020): commercial, corrected, self-billed, for accounting purposes. */
export const INVOICE_TYPE_CODES = ["380", "384", "389", "751"] as const;

/**
 * The VAT categories this builder writes (UNTDID 5305): S standard, Z zero
 * rated, E exempt, AE reverse charge, G export outside the EU, O outside the
 * scope of VAT. K (an intra-EU supply of goods) needs a delivery country and
 * date the builder does not take yet.
 */
export const VAT_CATEGORIES = ["S", "Z", "E", "AE", "G", "O"] as const;
export type VatCategory = (typeof VAT_CATEGORIES)[number];

/**
 * The exemption reason (BT-121, VATEX) a category without VAT carries when the
 * caller gives none; E has many and needs the caller's.
 */
export const DEFAULT_EXEMPTION: Readonly<Partial<Record<VatCategory, string>>> = {
  AE: "VATEX-EU-AE",
  G: "VATEX-EU-G",
  O: "VATEX-EU-O",
};

/** Categories whose breakdown must say why there is no VAT (BR-E-10, BR-AE-10, BR-G-10, BR-O-10). */
export const NEEDS_EXEMPTION: readonly VatCategory[] = ["E", "AE", "G", "O"];

/** ISO 3166-2:RO county codes, the CountrySubentity of a Romanian address (BR-RO-110). */
export const RO_COUNTIES = [
  "AB", "AG", "AR", "B", "BC", "BH", "BN", "BR", "BT", "BV", "BZ", "CJ", "CL", "CS", "CT", "CV", "DB", "DJ", "GJ", "GL", "GR",
  "HD", "HR", "IF", "IL", "IS", "MH", "MM", "MS", "NT", "OT", "PH", "SB", "SJ", "SM", "SV", "TL", "TM", "TR", "VL", "VN", "VS",
] as const;

/** In Bucharest (RO-B) the city is the sector, spelt as BR-RO-100 has it. */
export const BUCHAREST_SECTORS = ["SECTOR1", "SECTOR2", "SECTOR3", "SECTOR4", "SECTOR5", "SECTOR6"] as const;

/** UNTDID 4461 codes that mean a credit transfer, which must name the account to pay (BR-61). */
export const CREDIT_TRANSFER = ["30", "58"] as const;

/** Lengths CIUS-RO caps (BR-RO-L*), in characters. */
export const MAX = {
  number: 200,
  note: 300,
  notes: 20,
  reference: 200,
  partyName: 200,
  street: 150,
  additionalStreet: 100,
  city: 50,
  postalCode: 20,
  contact: 100,
  itemName: 100,
  itemDescription: 200,
  lineNote: 300,
  terms: 300,
  paymentId: 140,
  lines: 999,
} as const;
