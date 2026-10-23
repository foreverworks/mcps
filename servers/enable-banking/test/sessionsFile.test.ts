/**
 * The format of sessions.json, pinned. The format is a contract: other programs
 * may read this file. It has one definition, domain/sessionsFile.ts, and this
 * file checks the bytes the store writes against it and against a reader
 * written to that contract: by session_id, aspsp, psu_type,
 * access.valid_until, and each account's identification_hash, with a hash of
 * the uid as a fallback.
 *
 * If a test here fails, a reader of the file breaks with it.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { entryGaps } from "../src/domain/sessionsFile.js";
import { makeSessionStore } from "../src/infra/sessionStore.js";
import { ACCOUNTS, SESSION_ID, sessionResponse, UIDS, VALID_UNTIL } from "./fixtures.js";
import { pathsOf, testEnv } from "./support.js";

type Mapping = Readonly<Record<string, unknown>>;
const mapping = (v: unknown): Mapping | undefined => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Mapping) : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);

/**
 * Another program's reader, rule for rule: entries without a session id skipped,
 * the account identity from identification_hash (else a hash of the uid), the
 * IBAN from account_id.iban only, and the entry's shape detected by its
 * accounts' fields.
 */
const readerLoad = (text: string) =>
  Object.fromEntries(
    Object.entries(JSON.parse(text) as Mapping).flatMap(([key, blob]) => {
      const entry = mapping(blob);
      const sessionId = str(entry?.["session_id"]);
      if (entry === undefined || sessionId === undefined) return [];
      const accounts = (Array.isArray(entry["accounts"]) ? entry["accounts"] : []).map(mapping).filter((a) => a !== undefined);
      const aspsp = mapping(entry["aspsp"]) ?? {};
      return [
        [
          key,
          {
            schema: accounts.some((a) => "identification_hash" in a || "account_id" in a)
              ? "v2"
              : accounts.some((a) => "uid" in a || "identification" in a)
                ? "v1"
                : "v2",
            sessionId,
            aspspName: str(aspsp["name"]) ?? "",
            aspspCountry: (str(aspsp["country"]) ?? "").toUpperCase(),
            psuType: (str(entry["psu_type"]) ?? "").toLowerCase(),
            validUntil: str(mapping(entry["access"])?.["valid_until"]),
            accounts: accounts.map((a) => ({
              identityHash: str(a["identification_hash"]) ?? `uid:${createHash("sha256").update(String(a["uid"])).digest("hex")}`,
              identitySource: str(a["identification_hash"]) === undefined ? "uid_sha256" : "identification_hash",
              uid: str(a["uid"]),
              iban: str(mapping(a["account_id"])?.["iban"]),
              currency: (str(a["currency"]) ?? "XXX").toUpperCase(),
              displayName: str(a["name"]) ?? str(a["product"]),
            })),
          },
        ],
      ];
    }),
  );

const LABEL = "example_bank_de";
const oneAccount = sessionResponse({ accounts: [ACCOUNTS[0]] });

/** The file after one consent, byte for byte: two-space JSON, keys in the API's order, one trailing newline. */
const EXPECTED_FILE = `{
  "example_bank_de": {
    "session_id": "${SESSION_ID}",
    "accounts": [
      {
        "account_id": {
          "iban": "DE00SYNT00000000000001",
          "other": null
        },
        "all_account_ids": [
          {
            "identification": "DE00SYNT00000000000001",
            "scheme_name": "IBAN",
            "issuer": null
          }
        ],
        "account_servicer": null,
        "name": "SYNTHETIC CURRENT",
        "details": null,
        "usage": null,
        "cash_account_type": "CACC",
        "product": "SYNTHETIC BUSINESS CURRENT",
        "currency": "EUR",
        "psu_status": null,
        "credit_limit": null,
        "legal_age": null,
        "postal_address": null,
        "uid": "11111111-2222-4333-8444-555555555501",
        "identification_hash": "hash-eur",
        "identification_hashes": [
          "hash-eur-short",
          "hash-eur"
        ]
      }
    ],
    "aspsp": {
      "name": "Example Bank",
      "country": "DE"
    },
    "psu_type": "business",
    "access": {
      "accounts": null,
      "balances": true,
      "transactions": true,
      "valid_until": "${VALID_UNTIL}"
    }
  }
}
`;

describe("sessions.json as another program reads it", () => {
  it("is written byte for byte in the pinned format", async () => {
    const paths = pathsOf(testEnv());
    await makeSessionStore(paths).save(LABEL, oneAccount);
    expect(readFileSync(paths.sessions, "utf8")).toBe(EXPECTED_FILE);
  });

  it("imports in the current shape, keyed by its label, with every account re-linkable", async () => {
    const paths = pathsOf(testEnv());
    await makeSessionStore(paths).save(LABEL, sessionResponse());
    const loaded = readerLoad(readFileSync(paths.sessions, "utf8"));
    expect(Object.keys(loaded)).toEqual(["example_bank_de"]);
    expect(loaded["example_bank_de"]).toEqual({
      schema: "v2",
      sessionId: SESSION_ID,
      aspspName: "Example Bank",
      aspspCountry: "DE",
      psuType: "business",
      validUntil: VALID_UNTIL,
      accounts: [
        { identityHash: "hash-eur", identitySource: "identification_hash", uid: UIDS[0], iban: "DE00SYNT00000000000001", currency: "EUR", displayName: "SYNTHETIC CURRENT" },
        { identityHash: "hash-savings", identitySource: "identification_hash", uid: UIDS[1], iban: "DE00SYNT00000000000002", currency: "EUR", displayName: "SYNTHETIC SAVINGS" },
        { identityHash: "hash-gbp", identitySource: "identification_hash", uid: UIDS[2], iban: "DE00SYNT00000000000003", currency: "GBP", displayName: "SYNTHETIC GBP" },
      ],
    });
  });

  it("has no gaps for a complete code exchange, and names each one that would break the import", () => {
    expect(entryGaps(sessionResponse())).toEqual([]);
    expect(entryGaps({ ...sessionResponse(), session_id: "" })).toEqual(["no session_id: a reader skips the entry"]);
    expect(entryGaps({ ...sessionResponse(), aspsp: { name: "", country: "Germany" } })).toEqual([
      "no aspsp.name",
      "no two-letter aspsp.country",
    ]);
    expect(entryGaps({ ...sessionResponse(), psu_type: "corporate", access: {} })).toEqual([
      "psu_type is neither business nor personal",
      "no readable access.valid_until",
    ]);
    expect(entryGaps({ ...sessionResponse(), accounts: [{ uid: "u" }, "u2"] })).toEqual([
      "accounts[0] has no identification_hash, so a renewal cannot re-link it",
      "accounts[1] is not an object",
    ]);
  });

  it("keeps a file another program wrote readable to both after this server adds a label", async () => {
    // A file written by another JSON writer (e.g. Python's json.dumps(indent=2)):
    // the same two-space layout, no trailing newline, non-ASCII escaped. Both
    // parse to the same value.
    const paths = pathsOf(testEnv());
    mkdirSync(paths.stateDir, { recursive: true });
    const foreignEntry = sessionResponse({ accounts: [{ ...ACCOUNTS[0], name: "Cont curent și economii" }] });
    writeFileSync(paths.sessions, JSON.stringify({ example_bank_de: foreignEntry }, null, 2).replace("ș", "\\u0219"));
    const store = makeSessionStore(paths);
    expect((await store.read()).sessions[0]?.accounts[0]?.name).toBe("Cont curent și economii");

    await store.save("second_consent", sessionResponse({ session_id: "s-2" }));
    const loaded = readerLoad(readFileSync(paths.sessions, "utf8"));
    expect(Object.keys(loaded)).toEqual(["example_bank_de", "second_consent"]);
    expect(loaded["example_bank_de"]?.accounts[0]?.displayName).toBe("Cont curent și economii");
  });
});
