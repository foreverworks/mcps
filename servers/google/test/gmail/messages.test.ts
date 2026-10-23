/**
 * The adapter's many-at-once read: one id that fails is that item's, a
 * cancelled call is the whole call's. Fakes only.
 */
import { inCall } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import { apiError, fail } from "../../src/domain/errors.js";
import { makeGmailApi } from "../../src/gmail/infra/gmailApi.js";

const MESSAGES = "https://gmail.googleapis.com/gmail/v1/users/me/messages/";

describe("getMessages", () => {
  it("reads every id through its own path segment and reports a failed one in its place", async () => {
    const urls: string[] = [];
    const getJson = async (url: string) => {
      urls.push(url);
      if (url.endsWith("/gone")) return fail(apiError(404, "Requested entity was not found.", { reason: "notFound" }));
      return { id: url.slice(MESSAGES.length) };
    };
    const out = await makeGmailApi(getJson as never, async () => "token").getMessages(["a/b", "gone"], { format: "full" });
    expect(urls).toEqual([`${MESSAGES}a%2Fb`, `${MESSAGES}gone`]);
    expect(out).toEqual([
      { ok: true, value: { id: "a%2Fb" } },
      { ok: false, reason: "notFound" },
    ]);
  });

  it("stops the whole call when the client cancelled, instead of reporting each id as failed", async () => {
    const controller = new AbortController();
    const getJson = async () => {
      controller.abort();
      return fail(apiError(503, "Backend Error"));
    };
    const gmail = makeGmailApi(getJson as never, async () => "token");
    await expect(inCall({ signal: controller.signal }, () => gmail.getMessages(["a", "b"], { format: "full" }))).rejects.toMatchObject({ error: { kind: "cancelled" } });
  });
});
