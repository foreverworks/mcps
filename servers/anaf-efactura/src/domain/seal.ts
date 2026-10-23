import { C14N_ALGORITHMS, type C14nMode, canonicalize } from "./seal/c14n.js";
import { inScope, namespaceOf, readXml, splitName, type XmlElement } from "./seal/xml.js";

/**
 * ANAF's seal on an e-Factura document: `semnatura_<id>.xml` beside the
 * invoice in every archive `/descarcare` serves.
 *
 * It is a DETACHED XML-DSig signature, as the archives `/descarcare` serves
 * show it:
 *
 * - one `Reference` with `URI=""` and no transforms, whose `DigestValue` is
 *   SHA-256 over the invoice file's RAW BYTES (not a canonical form: ANAF
 *   seals the file it stored, byte for byte);
 * - `SignedInfo` canonicalized with Canonical XML 1.0 and signed RSA-SHA1;
 * - one X.509 certificate in `KeyInfo`, issued to Ministerul Finanțelor
 *   (organizationIdentifier 25886108) by Trans Sped's qualified seal CA;
 * - base64 values wrapped at 76 characters with `&#13;\n`, the way Apache
 *   Santuario writes them, so they must be read by an XML parser, not a regex.
 *
 * This module reads that shape and nothing looser: anything it does not
 * recognise is `unsupported`, which the caller treats as "ask ANAF", never as
 * "valid".
 */
export const DSIG = "http://www.w3.org/2000/09/xmldsig#";

export type Hash = "sha1" | "sha256" | "sha384" | "sha512";

const SIGNATURE_METHODS: Readonly<Record<string, Hash>> = {
  "http://www.w3.org/2000/09/xmldsig#rsa-sha1": "sha1",
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256": "sha256",
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha384": "sha384",
  "http://www.w3.org/2001/04/xmldsig-more#rsa-sha512": "sha512",
};

const DIGEST_METHODS: Readonly<Record<string, Hash>> = {
  "http://www.w3.org/2000/09/xmldsig#sha1": "sha1",
  "http://www.w3.org/2001/04/xmlenc#sha256": "sha256",
  "http://www.w3.org/2001/04/xmldsig-more#sha384": "sha384",
  "http://www.w3.org/2001/04/xmlenc#sha512": "sha512",
};

export type SealDocument = {
  /** SignedInfo canonicalized as its CanonicalizationMethod says: the bytes the RSA signature covers. */
  readonly signedInfo: string;
  readonly c14n: C14nMode;
  readonly signatureHash: Hash;
  readonly digestHash: Hash;
  /** DigestValue, decoded: the hash of the invoice's raw bytes. */
  readonly digest: Buffer;
  readonly signature: Buffer;
  /** Every X509Certificate in KeyInfo, DER. */
  readonly certificates: readonly Buffer[];
};

export type SealReading = { readonly ok: true; readonly seal: SealDocument } | { readonly ok: false; readonly why: string };

type Scoped = { readonly element: XmlElement; readonly scope: ReadonlyMap<string, string> };

const isDsig = (s: Scoped, local: string): boolean =>
  splitName(s.element.name).local === local && namespaceOf(s.element.name, s.scope, false) === DSIG;

const childElements = (parent: Scoped): readonly Scoped[] =>
  parent.element.children.flatMap((c) => (c.kind === "element" ? [{ element: c, scope: inScope(parent.scope, c) }] : []));

const onlyText = (s: Scoped): string =>
  s.element.children.map((c) => (c.kind === "text" ? c.text : "")).join("");

const attribute = (s: Scoped, name: string): string | undefined => s.element.attributes.find((a) => a.name === name)?.value;

/** Strict base64: whitespace (the line wraps) removed, then nothing but the alphabet and its padding. */
const base64 = (text: string): Buffer | undefined => {
  const compact = text.replace(/\s+/g, "");
  return compact !== "" && compact.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(compact) ? Buffer.from(compact, "base64") : undefined;
};

export const readSeal = (text: string): SealReading => {
  const unsupported = (why: string): SealReading => ({ ok: false, why });
  const parsed = readXml(text);
  if (!parsed.ok) return unsupported(`the seal is not well-formed XML: ${parsed.why}`);
  const signature: Scoped = { element: parsed.root, scope: inScope(new Map(), parsed.root) };
  if (!isDsig(signature, "Signature")) return unsupported(`the root element is ${parsed.root.name}, not an XML-DSig Signature`);

  const parts = childElements(signature);
  const one = (from: readonly Scoped[], local: string): Scoped | undefined => {
    const found = from.filter((s) => isDsig(s, local));
    return found.length === 1 ? found[0] : undefined;
  };
  const signedInfo = one(parts, "SignedInfo");
  const signatureValue = one(parts, "SignatureValue");
  if (signedInfo === undefined || signatureValue === undefined) return unsupported("the seal needs exactly one SignedInfo and one SignatureValue");

  const info = childElements(signedInfo);
  const c14nMethod = one(info, "CanonicalizationMethod");
  const signatureMethod = one(info, "SignatureMethod");
  const references = info.filter((s) => isDsig(s, "Reference"));
  if (c14nMethod === undefined || signatureMethod === undefined) return unsupported("SignedInfo lacks its CanonicalizationMethod or SignatureMethod");
  // A child (InclusiveNamespaces, HMACOutputLength) changes what the algorithm means; none is supported.
  if (childElements(c14nMethod).length > 0 || childElements(signatureMethod).length > 0)
    return unsupported("the canonicalization or signature method carries parameters");
  const c14n = C14N_ALGORITHMS[attribute(c14nMethod, "Algorithm") ?? ""];
  const signatureHash = SIGNATURE_METHODS[attribute(signatureMethod, "Algorithm") ?? ""];
  if (c14n === undefined) return unsupported(`canonicalization ${attribute(c14nMethod, "Algorithm")} is not supported`);
  if (signatureHash === undefined) return unsupported(`signature method ${attribute(signatureMethod, "Algorithm")} is not supported`);

  const [reference, ...more] = references;
  if (reference === undefined || more.length > 0) return unsupported(`the seal has ${references.length} references, not one`);
  if (attribute(reference, "URI") !== "") return unsupported(`the reference points at "${attribute(reference, "URI")}", not at the detached invoice (URI="")`);
  const referenceParts = childElements(reference);
  if (referenceParts.some((s) => isDsig(s, "Transforms"))) return unsupported("the reference applies transforms; ANAF's digest is over the raw file");
  const digestMethod = one(referenceParts, "DigestMethod");
  const digestValue = one(referenceParts, "DigestValue");
  const digestHash = DIGEST_METHODS[(digestMethod && attribute(digestMethod, "Algorithm")) ?? ""];
  if (digestHash === undefined) return unsupported(`digest method ${digestMethod && attribute(digestMethod, "Algorithm")} is not supported`);
  const digest = digestValue && base64(onlyText(digestValue));
  const signatureBytes = base64(onlyText(signatureValue));
  if (digest === undefined || signatureBytes === undefined) return unsupported("DigestValue or SignatureValue is not base64");

  const keyInfo = one(parts, "KeyInfo");
  const certificates = (keyInfo === undefined ? [] : childElements(keyInfo))
    .filter((s) => isDsig(s, "X509Data"))
    .flatMap(childElements)
    .filter((s) => isDsig(s, "X509Certificate"))
    .map((s) => base64(onlyText(s)));
  if (certificates.length === 0 || certificates.some((c) => c === undefined)) return unsupported("KeyInfo carries no readable X509Certificate");

  const canonical = canonicalize(signedInfo.element, [signature.element], c14n);
  if (!canonical.ok) return unsupported(`SignedInfo cannot be canonicalized: ${canonical.why}`);

  return {
    ok: true,
    seal: {
      signedInfo: canonical.bytes,
      c14n,
      signatureHash,
      digestHash,
      digest,
      signature: signatureBytes,
      certificates: certificates as readonly Buffer[],
    },
  };
};

/**
 * ANAF's verdict from /api/validate/signature, which answers HTTP 200 either
 * way with prose under `msg`. Read by the two sentences its own document
 * gives (validaresemnatura.html, "Validare fisiere incarcate" and
 * "Nevalidare fisiere incarcate"); anything else is neither, and says so.
 */
export const anafSealVerdict = (msg: string | undefined): boolean | undefined => {
  const text = (msg ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
  if (text.startsWith("Fișierele încărcate au fost validate cu succes")) return true;
  if (text.startsWith("Fișierele încărcate NU au putut fi validate")) return false;
  return undefined;
};
