/**
 * A throwaway certificate for the tests, made here: node:crypto signs but
 * does not build X.509, so this writes the few DER structures a certificate
 * needs (RFC 5280). Keys are generated per run; none is stored anywhere.
 */
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";

const length = (n: number): Buffer => (n < 0x80 ? Buffer.from([n]) : n < 0x100 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 0xff]));
const tlv = (tag: number, body: Buffer): Buffer => Buffer.concat([Buffer.from([tag]), length(body.length), body]);
const sequence = (...items: Buffer[]): Buffer => tlv(0x30, Buffer.concat(items));
const oid = (dotted: string): Buffer => {
  const [first = 0, second = 0, ...rest] = dotted.split(".").map(Number);
  const bytes = [40 * first + second];
  for (const value of rest) {
    const groups = [value & 0x7f];
    for (let v = value >> 7; v > 0; v >>= 7) groups.unshift((v & 0x7f) | 0x80);
    bytes.push(...groups);
  }
  return tlv(0x06, Buffer.from(bytes));
};
const name = (commonName: string): Buffer => sequence(tlv(0x31, sequence(oid("2.5.4.3"), tlv(0x0c, Buffer.from(commonName)))));
const utcTime = (at: Date): Buffer => tlv(0x17, Buffer.from(`${at.toISOString().replace(/[-:T]/g, "").slice(2, 14)}Z`));
const ECDSA_SHA256 = sequence(oid("1.2.840.10045.4.3.2"));

export type TestCertificate = { readonly pem: string; readonly key: KeyObject; readonly keyPem: string };

export const testCertificate = (domain: string, notAfter: Date, signer?: KeyObject): TestCertificate => {
  const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const san = sequence(oid("2.5.29.17"), tlv(0x04, sequence(tlv(0x82, Buffer.from(domain)), tlv(0x82, Buffer.from(`*.${domain}`)))));
  const tbs = sequence(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))),
    tlv(0x02, Buffer.from([1])),
    ECDSA_SHA256,
    name("Example Test CA"),
    sequence(utcTime(new Date(notAfter.getTime() - 90 * 86_400_000)), utcTime(notAfter)),
    name(domain),
    pair.publicKey.export({ type: "spki", format: "der" }),
    tlv(0xa3, sequence(san)),
  );
  const der = sequence(tbs, ECDSA_SHA256, tlv(0x03, Buffer.concat([Buffer.from([0]), sign("sha256", tbs, signer ?? pair.privateKey)])));
  const lines = der.toString("base64").match(/.{1,64}/g) ?? [];
  return {
    pem: `-----BEGIN CERTIFICATE-----\n${lines.join("\n")}\n-----END CERTIFICATE-----\n`,
    key: pair.privateKey,
    keyPem: pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  };
};
