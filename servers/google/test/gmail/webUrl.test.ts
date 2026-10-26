/**
 * The link builder, pinned. Its encoding was proved against tokens Gmail
 * itself put in its address bar (see webUrl.ts); the ids here are invented, in
 * the same formats, and each expected token is what that proved encoding gives
 * for them, written out as a literal. If these drift, the links stop opening
 * what they name, silently: nothing else in the suite would notice.
 */
import { describe, expect, it } from "vitest";

import { draftUrl, gmailToken, messageUrl, threadUrl } from "../../src/gmail/domain/webUrl.js";

describe("gmailToken", () => {
  it("encodes each form of legacy id Gmail puts in its own address bar", () => {
    // a standalone draft, opened from the Drafts folder
    expect(gmailToken("f:1783425452438716432|msg-a:r1111111111111111111+msg-a:r1111111111111111111")).toBe(
      "JHrtffdvJsfzqDXtnRcngHHshfzVstbvjFQmqszhfqhGKDDQqmqQBrzlmvpPxKgtkLZkDngNhnnqrvmVpNShnjklclBxHLSXBQmStlwgczvlHgXGW",
    );
    // Google's own MCP server's draft link, after Gmail redirected it
    expect(gmailToken("f:1783425452438716448+msg-a:r-2222222222222222222")).toBe(
      "CqMvqmWcCXJVjwGfSnKgwkBMMPPppFDZGKVFfFfQNkWsnfDFTdbPNkkPhxwFFzcBBwcGZLBtzLq",
    );
    // a conversation
    expect(gmailToken("f:1783425452438716417")).toBe("FMfcgzGwHpShGVtwlSdrcDmGvNtGVrXz");
  });
});

describe("draftUrl", () => {
  /** A consumer mailbox: the form follows the gmail.com domain. */
  const consumer = "user@gmail.com"; // personal-data-check: allow (the domain decides the form; the user is invented)

  it("opens a standalone draft in the compose window, by Gmail's own token", () => {
    expect(draftUrl(consumer, "18c0000000000010", "18c0000000000010", "r1111111111111111111")).toBe(
      `https://mail.google.com/mail/?authuser=${consumer}#all?compose=` +
        "JHrtffdvJsfzqDXtnRcngHHshfzVstbvjFQmqszhfqhGKDDQqmqQBrzlmvpPxKgtkLZkDngNhnnqrvmVpNShnjklclBxHLSXBQmStlwgczvlHgXGW",
    );
  });

  /** The Workspace form, which opened a draft in a Workspace mailbox where the consumer form did not. */
  it("uses the Workspace form for a Workspace mailbox", () => {
    const url = draftUrl("ana@example.com", "18c0000000000030", "18c0000000000030", "r3333333333333333333");
    expect(url).toBe(
      `https://mail.google.com/mail/?authuser=ana@example.com#all?compose=${gmailToken("f:1783425452438716464+msg-a:r3333333333333333333")}`,
    );
    // the token's start as a literal, so an encoding that only agrees with itself is still caught
    expect(url).toContain("#all?compose=lLtBPZxrklnNbmvhHcmGljxgNCZPbhgRqdNVmvjpXPqt");
  });

  /** Gmail has no compose link for a reply draft; it lives inline at the foot of the conversation. */
  it("sends a reply draft to its conversation", () => {
    expect(draftUrl(consumer, "18c0000000000001", "18c0000000000003", "r4444444444444444444")).toBe(
      `https://mail.google.com/mail/?authuser=${consumer}#all/thread-f:1783425452438716417`,
    );
  });
});

describe("messageUrl / threadUrl", () => {
  it("writes the ids in decimal, as Gmail's web client does", () => {
    expect(threadUrl("ana@example.com", "18c0000000000001")).toBe("https://mail.google.com/mail/?authuser=ana@example.com#all/thread-f:1783425452438716417");
    expect(messageUrl("ana@example.com", "18c0000000000001", "18c0000000000002")).toContain("|msg-f:");
  });
});
