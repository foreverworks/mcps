/**
 * Fakes shared by the use-case tests. No network, no credentials: every port
 * answers from a closure, and a test overrides only what it is about.
 */
import { readInputFile } from "@foreverworks/mcp-kit";

import type { Deps, GmailPort, GmailWritePort, GrantHandle } from "../../src/gmail/app/ports.js";
import type { GrantRole } from "../../src/gmail/domain/grants.js";

export const MODIFY = "https://www.googleapis.com/auth/gmail.modify";
export const READONLY = "https://www.googleapis.com/auth/gmail.readonly";

export const gmailStub = (over: Partial<GmailPort> = {}): GmailPort => ({
  profile: async () => ({ emailAddress: "me@example.com" }),
  tokenInfo: async () => ({}),
  labels: async () => ({ labels: [] }),
  filters: async () => ({}),
  listThreads: async () => ({}),
  getThread: async () => ({}),
  getThreads: async () => [],
  getMessage: async () => ({}),
  getMessages: async () => [],
  getAttachment: async () => Buffer.alloc(0),
  listHistory: async () => ({}),
  ...over,
});

const refuse = (what: string) => async (): Promise<never> => {
  throw new Error(`the fake write port was not expected to ${what}`);
};

export const writeStub = (over: Partial<GmailWritePort> = {}): GmailWritePort => ({
  sendAs: async () => ({ sendAs: [{ sendAsEmail: "me@example.com", isPrimary: true, isDefault: true, displayName: "" }] }),
  createDraft: async (_raw, threadId) => ({ id: "r-1", message: { id: "d1", threadId: threadId ?? "d1" } }),
  updateDraft: async (id, _raw, threadId) => ({ id, message: { id: "d2", threadId: threadId ?? "d2" } }),
  getDraft: refuse("read a draft"),
  listDrafts: async () => ({}),
  deleteDraft: async () => undefined,
  sendDraft: async () => ({ id: "s1", threadId: "t1", labelIds: ["SENT"] }),
  sendMessage: async (_raw, threadId) => ({ id: "s1", threadId: threadId ?? "s1", labelIds: ["SENT"] }),
  modifyMessages: async () => undefined,
  modifyThread: async () => ({}),
  trash: async () => ({}),
  untrash: async () => ({}),
  createLabel: async (spec) => ({ id: "Label_1", name: spec.name ?? "" }),
  updateLabel: async (id, spec) => ({ id, name: spec.name ?? "" }),
  deleteLabel: async () => undefined,
  createFilter: async (spec) => ({ id: "F1", criteria: spec.criteria, action: { addLabelIds: [...spec.action.addLabelIds], removeLabelIds: [...spec.action.removeLabelIds] } }),
  deleteFilter: async () => undefined,
  ...over,
});

export const grantStub = (role: GrantRole, scope: string, credentials = `/creds/${role}.json`): GrantHandle => ({
  role,
  credentials,
  scopes: async () => scope.split(" "),
  declaration: async () => ({ clientId: "c", scopes: [scope] }),
  tokenInfo: async () => ({ aud: "c", scope }),
  profile: async () => ({ emailAddress: "me@example.com" }),
});

/** The parts of Deps a read-only test does not care about. */
export const grantExtras = (role: GrantRole = "modify", scope = role === "modify" ? MODIFY : READONLY) => {
  const grant = grantStub(role, scope);
  let n = 0;
  return { grant, grants: [grant], write: writeStub(), boundary: () => `b${(n += 1)}`, timeZone: "Europe/Bucharest" };
};

export const depsWith = (over: Partial<Deps> = {}): Deps => ({
  account: "personal",
  address: "me@example.com",
  gmail: gmailStub(),
  // The kit's real reader, with no roots: base64 with its sha256 works, a path is refused.
  files: { writeFile: async () => "/tmp/x", readInput: (source) => readInputFile(source, { roots: [] }) },
  htmlToText: (h) => h.replace(/<[^>]+>/g, ""),
  paths: { stateDir: "/s", attachmentsDir: "/s/attachments" },
  ...grantExtras(),
  ...over,
});
