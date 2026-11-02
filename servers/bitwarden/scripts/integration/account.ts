/**
 * A throwaway account on a Bitwarden-compatible server (a local Vaultwarden),
 * made the way Bitwarden's clients make one, and its personal API key: what
 * the integration run needs to start the server against a real vault.
 *
 * The cryptography is Bitwarden's account model: the master key is
 * PBKDF2-SHA256 of the master password salted with the e-mail, the server is
 * sent one more PBKDF2 round of it, and the account's random 64-byte user key
 * travels encrypted with the master key stretched by HKDF ("enc", "mac"), as
 * an AES-256-CBC + HMAC-SHA256 cipher string `2.<iv>|<data>|<mac>`. Nothing
 * here is kept: the account lives as long as the server's volatile storage.
 */
import { createCipheriv, createHmac, generateKeyPairSync, pbkdf2Sync, randomBytes, randomUUID } from "node:crypto";

export type TestAccount = { readonly email: string; readonly masterPassword: string; readonly clientId: string; readonly clientSecret: string };

const ITERATIONS = 600_000;

const hkdfExpand = (key: Buffer, info: string): Buffer => createHmac("sha256", key).update(Buffer.concat([Buffer.from(info), Buffer.from([1])])).digest();

/** A type 2 cipher string: AES-256-CBC, then HMAC-SHA256 over the IV and the data. */
const encrypt = (plain: Buffer, encKey: Buffer, macKey: Buffer): string => {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", encKey, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  const mac = createHmac("sha256", macKey).update(Buffer.concat([iv, data])).digest();
  return `2.${iv.toString("base64")}|${data.toString("base64")}|${mac.toString("base64")}`;
};

const post = async (url: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> => {
  const form = headers["content-type"] === "application/x-www-form-urlencoded";
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${new URL(url).pathname} answered ${response.status}: ${text.slice(0, 300)}`);
  if (text === "") return {};
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

export const makeTestAccount = async (server: string): Promise<TestAccount> => {
  const email = `it-${Date.now()}-${randomBytes(3).toString("hex")}@example.com`;
  const masterPassword = randomBytes(24).toString("base64url");
  const masterKey = pbkdf2Sync(masterPassword, email.toLowerCase(), ITERATIONS, 32, "sha256");
  const masterPasswordHash = pbkdf2Sync(masterKey, masterPassword, 1, 32, "sha256").toString("base64");
  const userKey = randomBytes(64);
  const protectedKey = encrypt(userKey, hkdfExpand(masterKey, "enc"), hkdfExpand(masterKey, "mac"));
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKey = rsa.publicKey.export({ format: "der", type: "spki" }).toString("base64");
  const encryptedPrivateKey = encrypt(rsa.privateKey.export({ format: "der", type: "pkcs8" }), userKey.subarray(0, 32), userKey.subarray(32));

  // Bitwarden's two-step sign-up; a server that sends no mail answers the verification token itself.
  const sent = await post(`${server}/identity/accounts/register/send-verification-email`, { email, name: "Integration test", receiveMarketingEmails: false });
  if (typeof sent !== "string") throw new Error("the server sent a verification mail instead of answering its token: run it without mail (SIGNUPS_VERIFY unset)");
  await post(`${server}/identity/accounts/register/finish`, {
    email,
    emailVerificationToken: sent,
    masterPasswordHash,
    masterPasswordHint: null,
    userSymmetricKey: protectedKey,
    userAsymmetricKeys: { publicKey, encryptedPrivateKey },
    kdf: 0,
    kdfIterations: ITERATIONS,
  });

  const token = (await post(
    `${server}/identity/connect/token`,
    {
      grant_type: "password",
      username: email,
      password: masterPasswordHash,
      scope: "api offline_access",
      client_id: "cli",
      deviceType: "8",
      deviceIdentifier: randomUUID(),
      deviceName: "integration",
    },
    { "content-type": "application/x-www-form-urlencoded" },
  )) as { access_token: string };
  const subject = JSON.parse(Buffer.from(token.access_token.split(".")[1]!, "base64url").toString("utf8")) as { sub: string };
  const apiKey = (await post(`${server}/api/accounts/api-key`, { masterPasswordHash }, { authorization: `Bearer ${token.access_token}` })) as { apiKey: string };
  return { email, masterPassword, clientId: `user.${subject.sub}`, clientSecret: apiKey.apiKey };
};
