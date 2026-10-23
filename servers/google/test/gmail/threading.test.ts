/**
 * Replies and forwards: who they go to, what they are called, and the headers
 * that thread them in the other party's mailbox as well as ours.
 */
import { describe, expect, it } from "vitest";

import { formatAddress, parseAddressList } from "../../src/gmail/domain/addresses.js";
import {
  addressedAlias,
  forwardSubject,
  originalOf,
  replyRecipients,
  replySubject,
  threadHeaders,
} from "../../src/gmail/domain/threading.js";

const ME = ["ana.popescu@example.com"];

describe("parseAddressList", () => {
  it("reads display names, quoted names with commas, and bare addresses", () => {
    expect(parseAddressList('Maria Ionescu <r@recruiter.example>, "Doe, Jane" <jane@x.example>, plain@y.example')).toEqual([
      { name: "Maria Ionescu", email: "r@recruiter.example" },
      { name: "Doe, Jane", email: "jane@x.example" },
      { email: "plain@y.example" },
    ]);
  });

  it("drops what is not an address rather than guessing", () => {
    expect(parseAddressList("undisclosed-recipients:;")).toEqual([]);
  });
});

describe("formatAddress", () => {
  it("quotes a name that needs it and leaves a plain one bare", () => {
    expect(formatAddress({ name: "Doe, Jane", email: "j@x.example" })).toBe('"Doe, Jane" <j@x.example>');
    expect(formatAddress({ name: "Jane Doe", email: "j@x.example" })).toBe("Jane Doe <j@x.example>");
    expect(formatAddress({ email: "j@x.example" })).toBe("j@x.example");
  });

  it("passes an already-encoded name through unquoted, so it still decodes", () => {
    expect(formatAddress({ name: "=?UTF-8?B?w4hhIG5hbWU=?=", email: "j@x.example" })).toBe("=?UTF-8?B?w4hhIG5hbWU=?= <j@x.example>");
  });
});

describe("replySubject / forwardSubject", () => {
  it("adds Re: once and only once", () => {
    expect(replySubject("Example project")).toBe("Re: Example project");
    expect(replySubject("Re: Example project")).toBe("Re: Example project");
    expect(replySubject("RE: shouting")).toBe("RE: shouting");
    expect(replySubject(undefined)).toBe("Re:");
  });

  it("adds Fwd: unless it is already a forward", () => {
    expect(forwardSubject("Invoice 12")).toBe("Fwd: Invoice 12");
    expect(forwardSubject("Fwd: Invoice 12")).toBe("Fwd: Invoice 12");
    expect(forwardSubject("FW: Invoice 12")).toBe("FW: Invoice 12");
  });
});

describe("originalOf", () => {
  it("reads headers case-insensitively, since Gmail returns Message-Id as often as Message-ID", () => {
    const o = originalOf({ id: "m", threadId: "t" }, [
      { name: "Message-Id", value: "<a@b>" },
      { name: "reply-to", value: "desk@x.example" },
      { name: "Delivered-To", value: "one@x.example" },
      { name: "Delivered-To", value: "two@x.example" },
    ]);
    expect(o).toMatchObject({ id: "m", threadId: "t", messageId: "<a@b>", replyTo: "desk@x.example", deliveredTo: "one@x.example, two@x.example" });
  });
});

describe("threadHeaders", () => {
  it("answers the original's Message-ID and extends its References chain", () => {
    expect(threadHeaders({ messageId: "<3@x>", references: "<1@x> <2@x>" })).toEqual({
      inReplyTo: "<3@x>",
      references: ["<1@x>", "<2@x>", "<3@x>"],
    });
  });

  it("falls back to In-Reply-To when the original carries no References", () => {
    expect(threadHeaders({ messageId: "<2@x>", inReplyTo: "<1@x>" })).toEqual({ inReplyTo: "<2@x>", references: ["<1@x>", "<2@x>"] });
  });

  it("starts the chain at a first message", () => {
    expect(threadHeaders({ messageId: "<1@x>" })).toEqual({ inReplyTo: "<1@x>", references: ["<1@x>"] });
  });
});

describe("replyRecipients", () => {
  const incoming = {
    from: "Maria Ionescu <maria@recruiter.example>",
    to: "ana.popescu@example.com, colleague@recruiter.example",
    cc: "Boss <boss@recruiter.example>, Ana.Popescu@Example.com",
  };

  it("answers From when there is no Reply-To", () => {
    expect(replyRecipients(incoming, ME, false)).toEqual({ to: [{ name: "Maria Ionescu", email: "maria@recruiter.example" }], cc: [] });
  });

  it("prefers Reply-To over From", () => {
    const r = replyRecipients({ ...incoming, replyTo: "recruiting@agency.example" }, ME, false);
    expect(r.to).toEqual([{ email: "recruiting@agency.example" }]);
  });

  it("reply-all copies the original To and Cc, minus our own addresses in any case", () => {
    const r = replyRecipients(incoming, ME, true);
    expect(r.cc.map((a) => a.email)).toEqual(["colleague@recruiter.example", "boss@recruiter.example"]);
  });

  it("does not copy the person already in To", () => {
    const r = replyRecipients({ ...incoming, cc: "maria@recruiter.example" }, ME, true);
    expect(r.cc.map((a) => a.email)).toEqual(["colleague@recruiter.example"]);
  });

  /** The follow-up case: answering our own sent message goes to its recipients, as Gmail does. */
  it("answers a message WE sent by addressing its recipients", () => {
    const sent = { from: "Ana Popescu <ana.popescu@example.com>", to: "Maria Ionescu <maria.ionescu@recruiter.example>" };
    expect(replyRecipients(sent, ME, false).to).toEqual([{ name: "Maria Ionescu", email: "maria.ionescu@recruiter.example" }]);
  });
});

describe("addressedAlias", () => {
  it("picks the alias the original reached, in header order", () => {
    const mine = ["ana@work.example", "ana@alias.example"];
    expect(addressedAlias({ from: "x@y.example", to: "ana@alias.example" }, mine)).toBe("ana@alias.example");
    expect(addressedAlias({ from: "ana@work.example", to: "x@y.example" }, mine)).toBe("ana@work.example");
    expect(addressedAlias({ from: "x@y.example", to: "z@y.example" }, mine)).toBeUndefined();
  });
});
