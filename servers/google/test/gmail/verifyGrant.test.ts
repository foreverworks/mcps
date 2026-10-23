import { describe, expect, it } from "vitest";

import { judgeGrant } from "../../src/gmail/app/usecases/verifyGrant.js";
import { MODIFY, READONLY } from "./fakes.js";

const declared = { clientId: "client-a", scopes: [READONLY] };
const profile = { emailAddress: "someone@example.com", historyId: "42" };

describe("judgeGrant", () => {
  it("passes when the issuer agrees with what credentials.json declares", () => {
    const v = judgeGrant("readonly", declared, { aud: "client-a", scope: READONLY }, profile);
    expect(v).toMatchObject({ ok: true, problems: [], mailbox: "someone@example.com", historyId: "42", canWrite: false });
  });

  it("catches a token issued to a different OAuth client", () => {
    const v = judgeGrant("readonly", declared, { aud: "client-b", scope: READONLY }, profile);
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toContain("different OAuth client");
  });

  it("catches a grant narrower than the file claims", () => {
    const wide = { ...declared, scopes: [...declared.scopes, "https://www.googleapis.com/auth/gmail.send"] };
    const v = judgeGrant("readonly", wide, { aud: "client-a", scope: READONLY }, profile);
    expect(v.ok).toBe(false);
    expect(v.problems[0]).toContain("gmail.send");
  });

  it("does not complain about EXTRA scopes that cannot write", () => {
    const v = judgeGrant("readonly", declared, { aud: "client-a", scope: `${READONLY} openid` }, profile);
    expect(v.ok).toBe(true);
  });

  it("reports every problem at once rather than stopping at the first", () => {
    const wide = { clientId: "client-a", scopes: ["a", "b"] };
    const v = judgeGrant("readonly", wide, { aud: "other", scope: "a" }, profile);
    expect(v.problems).toHaveLength(2);
  });

  it("treats a missing scope string as granting nothing", () => {
    const v = judgeGrant("readonly", declared, { aud: "client-a" }, profile);
    expect(v.ok).toBe(false);
  });

  it("passes the server's own grant when it carries gmail.modify, and says it can write", () => {
    const v = judgeGrant("modify", { clientId: "client-a", scopes: [MODIFY] }, { aud: "client-a", scope: MODIFY }, profile);
    expect(v).toMatchObject({ ok: true, canWrite: true, role: "modify" });
  });

  it("fails the server's own grant when it lacks gmail.modify, even if the file agrees", () => {
    const v = judgeGrant("modify", declared, { aud: "client-a", scope: READONLY }, profile);
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toContain("gmail.modify");
  });

  /** Least privilege for a shared read-only grant, made checkable: its widening is exactly the drift to catch. */
  it("fails the read-only grant the moment it can write", () => {
    const v = judgeGrant("readonly", declared, { aud: "client-a", scope: `${READONLY} ${MODIFY}` }, profile);
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toContain("should hold gmail.readonly alone");
  });

  it("catches a credential consented as the wrong Google account", () => {
    const v = judgeGrant("modify", { clientId: "c", scopes: [MODIFY] }, { aud: "c", scope: MODIFY }, profile, "owner@example.com");
    expect(v.ok).toBe(false);
    expect(v.problems.join()).toContain("owner@example.com");
  });
});
