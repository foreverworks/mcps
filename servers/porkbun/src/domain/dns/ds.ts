import { decodeBase64Strict } from "@foreverworks/mcp-kit";

import { fail, inputError } from "../errors.js";

/**
 * A DNSSEC DS record (RFC 4034 section 5) and the DNSKEY it points at, as
 * text a model types: checked here for shape, so a digest one character short
 * fails before the registry publishes a chain of trust that breaks the domain.
 * Pure: the digest itself is computed in app/dns/dnskey.ts.
 */

/** IANA's DNSSEC algorithm numbers a zone can be signed with (RFC 8624, 9558, 9563); the registry decides which it still takes. */
const ALGORITHMS: ReadonlyMap<number, string> = new Map([
  [1, "RSAMD5"],
  [3, "DSA"],
  [5, "RSASHA1"],
  [6, "DSA-NSEC3-SHA1"],
  [7, "RSASHA1-NSEC3-SHA1"],
  [8, "RSASHA256"],
  [10, "RSASHA512"],
  [12, "ECC-GOST"],
  [13, "ECDSAP256SHA256"],
  [14, "ECDSAP384SHA384"],
  [15, "ED25519"],
  [16, "ED448"],
  [17, "SM2SM3"],
  [23, "ECC-GOST12"],
]);

/** IANA's DS digest types, with the hex length of each digest. */
export const DIGEST_TYPES: ReadonlyMap<number, { readonly name: string; readonly hexLength: number }> = new Map([
  [1, { name: "SHA-1", hexLength: 40 }],
  [2, { name: "SHA-256", hexLength: 64 }],
  [3, { name: "GOST R 34.11-94", hexLength: 64 }],
  [4, { name: "SHA-384", hexLength: 96 }],
  [5, { name: "GOST R 34.11-2012", hexLength: 64 }],
  [6, { name: "SM3", hexLength: 64 }],
]);

/** The DS record as the vendor's tool takes it: every field a decimal or hex string. */
export type Ds = { readonly keyTag: string; readonly alg: string; readonly digestType: string; readonly digest: string };

const DECIMAL = /^\d+$/;

const known = (map: ReadonlyMap<number, unknown>, text: string): number | undefined => (DECIMAL.test(text) && map.has(Number(text)) ? Number(text) : undefined);

const listOf = (map: ReadonlyMap<number, { readonly name: string } | string>): string =>
  [...map].map(([n, v]) => `${n} ${typeof v === "string" ? v : v.name}`).join(", ");

/** A digest as hex, without the spaces a signer prints it with; case is kept. */
export const compactDigest = (digest: string): string => digest.replace(/\s+/g, "");

/** Every way these four fields are not a DS record; empty when they are one. */
export const dsProblems = (ds: Ds): readonly string[] => {
  const problems: string[] = [];
  if (!DECIMAL.test(ds.keyTag) || Number(ds.keyTag) > 65535) problems.push(`keyTag "${ds.keyTag}" is not a key tag (a whole number from 0 to 65535)`);
  if (known(ALGORITHMS, ds.alg) === undefined) problems.push(`alg "${ds.alg}" is not a DNSSEC algorithm number (${listOf(ALGORITHMS)})`);
  const type = known(DIGEST_TYPES, ds.digestType);
  if (type === undefined) problems.push(`digestType "${ds.digestType}" is not a DS digest type (${listOf(DIGEST_TYPES)})`);
  const digest = compactDigest(ds.digest);
  if (!/^[0-9a-f]+$/i.test(digest)) {
    problems.push(`digest is not hexadecimal${digest === "" ? " (it is empty)" : ""}`);
  } else if (type !== undefined) {
    const { name, hexLength } = DIGEST_TYPES.get(type) as { readonly name: string; readonly hexLength: number };
    if (digest.length !== hexLength) problems.push(`digest has ${digest.length} hex characters; a ${name} digest (digestType ${type}) has ${hexLength}`);
  }
  return problems;
};

/** A DNSKEY record (RFC 4034 section 2), and the zone it was read for when the text named one. */
export type Dnskey = {
  readonly owner?: string;
  readonly flags: number;
  readonly protocol: number;
  readonly algorithm: number;
  readonly publicKey: Buffer;
};

/** The DNSKEY flag a key that signs a zone has (RFC 4034 2.1.1). */
const ZONE_KEY = 0x0100;
const CLASSES = new Set(["IN", "CH", "HS"]);

/**
 * A DNSKEY as a signer prints it: the zone-file line
 * (`example.com. 3600 IN DNSKEY 257 3 13 <base64>`, parentheses and `;`
 * comments allowed, the key split across lines), or only its data
 * (`257 3 13 <base64>`).
 */
export const parseDnskey = (text: string): Dnskey => {
  const tokens = text
    .replace(/;[^\n]*/g, " ")
    .replace(/[()]/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t !== "");
  const at = tokens.findIndex((t) => t.toUpperCase() === "DNSKEY");
  const head = at === -1 ? [] : tokens.slice(0, at);
  const [flagsText = "", protocolText = "", algorithmText = "", ...key] = at === -1 ? tokens : tokens.slice(at + 1);
  const owner = head[0] !== undefined && !DECIMAL.test(head[0]) && !CLASSES.has(head[0].toUpperCase()) ? head[0] : undefined;
  if (!DECIMAL.test(flagsText) || Number(flagsText) > 65535) return fail(inputError(`dnskey: "${flagsText}" is not a DNSKEY's flags (257 for a key-signing key, 256 for a zone-signing key)`));
  const flags = Number(flagsText);
  if ((flags & ZONE_KEY) === 0) return fail(inputError(`dnskey: flags ${flags} lack the zone key bit (256): that key does not sign a zone`));
  if (protocolText !== "3") return fail(inputError(`dnskey: the protocol field is "${protocolText}"; a DNSKEY's is always 3`));
  const algorithm = known(ALGORITHMS, algorithmText) ?? fail(inputError(`dnskey: "${algorithmText}" is not a DNSSEC algorithm number (${listOf(ALGORITHMS)})`));
  if (key.length === 0) return fail(inputError("dnskey: the public key (base64, after the algorithm) is missing"));
  const publicKey = decodeBase64Strict(key.join("")) ?? fail(inputError("dnskey: the public key is not standard base64; a character was lost or changed"));
  return { ...(owner === undefined ? {} : { owner }), flags, protocol: 3, algorithm, publicKey };
};

/** The DNSKEY's wire-format data: flags, protocol, algorithm, key (RFC 4034 2.1). */
export const dnskeyRdata = (key: Dnskey): Buffer =>
  Buffer.concat([Buffer.from([key.flags >> 8, key.flags & 0xff, key.protocol, key.algorithm]), key.publicKey]);

/** The key tag (RFC 4034 appendix B), for every algorithm but RSAMD5 (1), which nothing signs with any more. */
export const keyTagOf = (rdata: Buffer): number => {
  let sum = 0;
  for (const [i, byte] of rdata.entries()) sum += i % 2 === 0 ? byte << 8 : byte;
  sum += (sum >> 16) & 0xffff;
  return sum & 0xffff;
};

/** A name in canonical wire format (RFC 4034 6.2): lower case, each label behind its length, then the root. */
export const ownerWire = (name: string): Buffer =>
  Buffer.concat([
    ...name
      .toLowerCase()
      .replace(/\.$/, "")
      .split(".")
      .map((label) => Buffer.concat([Buffer.from([label.length]), Buffer.from(label, "ascii")])),
    Buffer.from([0]),
  ]);
