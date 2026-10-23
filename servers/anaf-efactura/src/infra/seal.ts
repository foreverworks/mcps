import { createHash, verify, X509Certificate } from "node:crypto";

import { compact } from "@foreverworks/mcp-kit";

import type { LocalSealCheck, SealCertificate } from "../app/ports.js";
import { readSeal } from "../domain/seal.js";

export type SealTrust = {
  /** The CAs whose seal certificates are ANAF's (infra/sealTrust.ts). */
  readonly anchors: readonly X509Certificate[];
  /** The organizationIdentifier the seal certificate must be issued to. */
  readonly organizationIdentifier: string;
};

const oneLine = (dn: string): string => dn.split("\n").join(", ");

const describe = (certificate: X509Certificate): SealCertificate => {
  const subject = certificate.toLegacyObject().subject as Readonly<Record<string, string | readonly string[] | undefined>>;
  const orgId = subject["organizationIdentifier"];
  return compact({
    subject: oneLine(certificate.subject),
    organizationIdentifier: typeof orgId === "string" ? orgId : undefined,
    issuer: oneLine(certificate.issuer),
    serialNumber: certificate.serialNumber,
    validFrom: new Date(certificate.validFrom).toISOString(),
    validTo: new Date(certificate.validTo).toISOString(),
  });
};

const parseCertificate = (der: Buffer): X509Certificate | undefined => {
  try {
    return new X509Certificate(der);
  } catch {
    return undefined;
  }
};

/**
 * ANAF's seal, checked here, without a network call and without spending
 * one of ANAF's ten downloads a day per message.
 *
 * Two answers are final: `valid` (issued by the pinned CA to the Ministry,
 * the RSA signature verifies over SignedInfo, and SignedInfo's digest is the
 * invoice's), and `invalid` when all of that holds except the digest: the
 * seal is ANAF's and the invoice is not the file it sealed. Anything short of
 * a verified signature (an unknown CA, an algorithm this code does not know, a
 * signature that does not verify over SignedInfo as canonicalized here) is
 * `inconclusive`, because a mistake in THIS code must never read as a forgery;
 * the caller asks ANAF then.
 *
 * `issuedOn` is the invoice's own date: ANAF sealed it after that, so a
 * certificate that had expired by then cannot be the one it sealed with. The
 * seal carries no timestamp, so this is the only clock there is.
 */
export const makeSealCheck =
  (trust: SealTrust) =>
  (invoice: Buffer, sealFile: Buffer, context: { readonly nowEpoch: number; readonly issuedOn?: string | undefined }): LocalSealCheck => {
    const inconclusive = (reason: string, certificate?: SealCertificate): LocalSealCheck =>
      certificate === undefined ? { verdict: "inconclusive", reason } : { verdict: "inconclusive", reason, certificate };

    const reading = readSeal(sealFile.toString("utf8"));
    if (!reading.ok) return inconclusive(reading.why);
    const seal = reading.seal;

    const certificates = seal.certificates.map(parseCertificate);
    const issued = certificates.find(
      (c): c is X509Certificate => c !== undefined && trust.anchors.some((anchor) => c.checkIssued(anchor) && c.verify(anchor.publicKey)),
    );
    const first = certificates.find((c): c is X509Certificate => c !== undefined);
    if (issued === undefined)
      return inconclusive(
        `the seal's certificate was not issued by a CA this server trusts (${trust.anchors.map((a) => oneLine(a.subject)).join("; ")})`,
        first === undefined ? undefined : describe(first),
      );
    const certificate = describe(issued);
    if (certificate.organizationIdentifier !== trust.organizationIdentifier)
      return inconclusive(
        `the certificate is issued to organizationIdentifier ${certificate.organizationIdentifier ?? "(none)"}, not the Ministry of Finance's ${trust.organizationIdentifier}`,
        certificate,
      );
    if (Date.parse(certificate.validFrom) > context.nowEpoch * 1000) return inconclusive("the certificate is not valid yet", certificate);
    if (context.issuedOn !== undefined && Date.parse(certificate.validTo) < Date.parse(`${context.issuedOn}T00:00:00Z`))
      return inconclusive(`the certificate expired before the invoice's date (${context.issuedOn})`, certificate);
    if (issued.publicKey.asymmetricKeyType !== "rsa") return inconclusive("the certificate's key is not RSA, as the signature method says", certificate);

    const signed = ((): boolean | string => {
      try {
        return verify(seal.signatureHash, Buffer.from(seal.signedInfo, "utf8"), issued.publicKey, seal.signature);
      } catch (cause) {
        return cause instanceof Error ? cause.message : String(cause);
      }
    })();
    if (typeof signed === "string") return inconclusive(`the signature cannot be checked here: ${signed}`, certificate);
    if (!signed) return inconclusive(`the signature does not verify over SignedInfo canonicalized as ${seal.c14n} C14N`, certificate);

    const actual = createHash(seal.digestHash).update(invoice).digest();
    return actual.equals(seal.digest)
      ? { verdict: "valid", certificate }
      : {
          verdict: "invalid",
          reason: "the seal is ANAF's, but the invoice is not the file it sealed: its bytes differ from what ANAF stored",
          certificate,
        };
  };
