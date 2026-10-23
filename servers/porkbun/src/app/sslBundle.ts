import { createPrivateKey, type KeyObject, X509Certificate } from "node:crypto";

import { resolveSaveDir, saveToOutbox, unsetPath } from "@foreverworks/mcp-kit";

import { hostnameProblem, normalHostname } from "../domain/dns/hostname.js";
import { fail, inputError, OUTBOX_VARIABLE } from "../domain/errors.js";
import type { Deps } from "./ports.js";

/**
 * get_ssl_bundle, with the private key kept out of the conversation. The
 * vendor's tool returns the certificate chain and its private key as PEM text
 * in the result, where it would land in a model's context and its transcript.
 * Here the bundle is checked (the key is the leaf certificate's) and written
 * to the outbox, readable by its owner and its group only, and the answer is the files' paths, sizes and
 * SHA-256 with what the certificate says: its subject, names, issuer and
 * validity. Nothing is written when the bundle does not hold together.
 */

/**
 * Owner read and write, group read, nobody else: an outbox's group is whoever
 * may take files out of it (a service's callers), and the key is no use to
 * anyone who cannot read it. Never world-readable.
 */
const BUNDLE_MODE = 0o640;

/** A field of Porkbun's /ssl/retrieve answer this reads; one that is missing is drift, not an empty file. */
const pemField = (answer: unknown, name: "certificatechain" | "privatekey"): string => {
  const value = typeof answer === "object" && answer !== null ? (answer as Readonly<Record<string, unknown>>)[name] : undefined;
  return typeof value === "string" && value.trim() !== "" ? value : fail({ kind: "drift", message: `Porkbun's SSL bundle answer has no ${name}` });
};

const CERTIFICATE = /-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+-----END CERTIFICATE-----/g;

const badBundle = (message: string): never => fail({ kind: "bad_bundle", message });

const parsed = <T>(make: () => T, what: string): T => {
  try {
    return make();
  } catch {
    return badBundle(what);
  }
};

const iso = (when: string): string => new Date(when).toISOString();

/** What the leaf certificate says, once its key is known to be the bundle's. */
const checkBundle = (chain: string, privateKey: string) => {
  const blocks = chain.match(CERTIFICATE) ?? [];
  if (blocks.length === 0) return badBundle("the certificate chain holds no PEM certificate");
  const certificates = blocks.map((block, i) => parsed(() => new X509Certificate(block), `certificate ${i + 1} of the chain does not parse`));
  const key: KeyObject = parsed(() => createPrivateKey(privateKey), "the private key does not parse");
  const leaf = certificates[0] as X509Certificate;
  if (!leaf.checkPrivateKey(key)) return badBundle("the private key is not the key of the chain's first certificate");
  return {
    subject: leaf.subject.split("\n").join(", "),
    names: (leaf.subjectAltName ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.startsWith("DNS:"))
      .map((entry) => entry.slice(4)),
    issuer: leaf.issuer.split("\n").join(", "),
    validFrom: iso(leaf.validFrom),
    validTo: iso(leaf.validTo),
    fingerprint256: leaf.fingerprint256,
    chainLength: certificates.length,
  };
};

const withNewline = (pem: string): string => (pem.endsWith("\n") ? pem : `${pem}\n`);

export const saveSslBundle = async (deps: Deps, args: { readonly domain: string; readonly saveDir?: string }) => {
  const outbox = deps.outbox ?? fail({ kind: "config", variable: OUTBOX_VARIABLE, message: unsetPath(OUTBOX_VARIABLE) });
  const domain = normalHostname(args.domain);
  const problem = hostnameProblem(domain);
  if (problem !== undefined) return fail(inputError(`domain: ${problem}`));
  const where = resolveSaveDir(outbox, args.saveDir);
  if (!where.ok) return fail(inputError(where.reason));

  const answer = await deps.porkbun.run("get_ssl_bundle", { domain });
  const chain = pemField(answer, "certificatechain");
  const privateKey = pemField(answer, "privatekey");
  const certificate = checkBundle(chain, privateKey);

  const save = async (name: string, holds: string, text: string) => {
    const { path, sha256, size } = await saveToOutbox(where.dir, name, withNewline(text), { mode: BUNDLE_MODE });
    return { path, holds, sha256, size };
  };
  const files = [
    await save(`${domain}.fullchain.pem`, "the certificate chain, the domain's certificate first", chain),
    await save(`${domain}.privkey.pem`, "the private key", privateKey),
  ];
  return { domain, certificate, files, mode: "0640" };
};
