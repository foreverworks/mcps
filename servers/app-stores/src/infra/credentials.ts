import { createPrivateKey, type KeyObject } from "node:crypto";

import { readSecret } from "@foreverworks/mcp-kit";

import { type AppError, fail, type Store } from "../domain/errors.js";

/**
 * Each store's credentials, read when a call first needs them: a key file
 * first (for a service, its credentials directory), else the variable holding
 * the text, for a local run. Nothing is read at start, so the server lists its
 * tools and answers health without any.
 */
const configError = (store: Store, message: string): AppError => ({ kind: "config", store, message });

const asKey = (store: Store, text: string, what: string): KeyObject => {
  try {
    return createPrivateKey(text);
  } catch {
    return fail(configError(store, `${what} is not a PEM private key`));
  }
};

/** An App Store Connect API key: the key's id, its team's issuer id, and the .p8 private key (P-256). */
export type AscKey = { readonly keyId: string; readonly issuerId: string; readonly key: KeyObject };

const ASC_KEY_ID = /^[A-Z0-9]{10}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const loadAscKey = async (env: NodeJS.ProcessEnv): Promise<AscKey> => {
  const keyId = env["ASC_KEY_ID"]?.trim() ?? "";
  const issuerId = env["ASC_ISSUER_ID"]?.trim() ?? "";
  const pem = await readSecret(env, { file: "ASC_PRIVATE_KEY_FILE", value: "ASC_PRIVATE_KEY" }, (m) => fail(configError("app_store", m)));
  const missing = [keyId === "" ? "ASC_KEY_ID" : "", issuerId === "" ? "ASC_ISSUER_ID" : "", pem === undefined ? "ASC_PRIVATE_KEY_FILE" : ""].filter((m) => m !== "");
  if (missing.length > 0) return fail(configError("app_store", `App Store Connect is not configured: ${missing.join(", ")} not set`));
  if (!ASC_KEY_ID.test(keyId)) return fail(configError("app_store", "ASC_KEY_ID is not an App Store Connect key id (10 letters and digits)"));
  if (!UUID.test(issuerId)) return fail(configError("app_store", "ASC_ISSUER_ID is not an issuer id (a UUID, shown above the keys in App Store Connect)"));
  const key = asKey("app_store", pem as string, "the App Store Connect key (ASC_PRIVATE_KEY_FILE)");
  if (key.asymmetricKeyType !== "ec") return fail(configError("app_store", "the App Store Connect key is not the .p8 key App Store Connect issued (an EC P-256 key)"));
  return { keyId, issuerId, key };
};

/** A Google service account, from its JSON key: who it is, which key, and the private key (RSA). */
export type ServiceAccount = { readonly email: string; readonly keyId: string; readonly key: KeyObject };

/** The one token endpoint an assertion is sent to, whatever a key file says. */
export const GOOGLE_TOKEN_URI = "https://oauth2.googleapis.com/token";

export const loadServiceAccount = async (env: NodeJS.ProcessEnv): Promise<ServiceAccount> => {
  const text = await readSecret(env, { file: "PLAY_SERVICE_ACCOUNT_FILE", value: "PLAY_SERVICE_ACCOUNT" }, (m) => fail(configError("play", m)));
  if (text === undefined) return fail(configError("play", "Google Play is not configured: PLAY_SERVICE_ACCOUNT_FILE is not set"));
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return fail(configError("play", "the service account key (PLAY_SERVICE_ACCOUNT_FILE) is not JSON"));
  }
  const field = (name: string): string => (typeof parsed[name] === "string" ? (parsed[name] as string) : "");
  if (field("type") !== "service_account" || field("client_email") === "" || field("private_key") === "" || field("private_key_id") === "") {
    return fail(configError("play", "PLAY_SERVICE_ACCOUNT_FILE is not a service account's JSON key (type service_account, with client_email, private_key and private_key_id)"));
  }
  const tokenUri = field("token_uri");
  if (tokenUri !== "" && tokenUri !== GOOGLE_TOKEN_URI) return fail(configError("play", `the service account key names a token endpoint other than Google's (${tokenUri})`));
  return { email: field("client_email"), keyId: field("private_key_id"), key: asKey("play", field("private_key"), "the service account's private_key") };
};
