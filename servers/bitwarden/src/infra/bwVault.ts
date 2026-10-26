import { memoize } from "@foreverworks/mcp-kit";
import type { z } from "zod";

import type { VaultPort } from "../app/ports.js";
import { authError, cliError, fail, inputError, notFound } from "../domain/errors.js";
import type { LoginDraft, NoteDraft } from "../domain/schema.js";
import type { Credentials } from "./credentials.js";
import { bwMessage, failed, type BwResult, type RunBw } from "./bw/run.js";
import {
  collectionOf,
  collectionWire,
  itemPayload,
  itemWire,
  LOGIN_TYPE,
  SECURE_NOTE_TYPE,
  loginOf,
  notePayload,
  organizationOf,
  organizationWire,
  statusOf,
  statusWire,
} from "./bw/wire.js";

/** A sync at most this often before a read: edits in the web vault show within half a minute, and a search does not pay 3 s for nothing. */
const SYNC_EVERY_MS = 30_000;
/** Collections and organisations change by hand, rarely. */
const LISTS_TTL_MS = 5 * 60_000;
/** An item id as the CLI prints it. `bw get item` also accepts a search term, which could answer with a different item. */
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The CLI's words when the session key is gone (another process locked it, the CLI was updated). */
const SESSION_GONE = /vault is locked|not logged in|session key is invalid/i;

export type BwVaultOptions = {
  readonly run: RunBw;
  readonly credentials: () => Promise<Credentials>;
  /** A self-hosted or EU server; unset means bitwarden.com. */
  readonly serverUrl: string | undefined;
  readonly now: () => number;
};

const parsed = <S extends z.ZodType>(result: BwResult, schema: S): z.infer<S> => {
  if (result.code !== 0) return failed(result);
  let json: unknown;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    return fail(cliError("bw answered with something that is not JSON"));
  }
  const checked = schema.safeParse(json);
  return checked.success ? checked.data : fail(cliError(`bw's JSON changed shape: ${checked.error.issues[0]?.message ?? "unknown"}`));
};

const checkId = (id: string): void => {
  if (!ID.test(id)) fail(inputError(`${id} is not an item id; find_logins gives them`));
};

/**
 * The vault through the official CLI. It holds ONE piece of state, the session
 * key from `bw unlock`, in this process's memory; losing it (a restart) costs
 * one login and one unlock on the next call.
 */
export const makeBwVault = ({ run, credentials, serverUrl, now }: BwVaultOptions): VaultPort => {
  let session: string | undefined;
  let lastSyncAt = 0;

  const unlock = async (): Promise<string> => {
    const creds = await credentials();
    const status = parsed(await run(["status"]), statusWire);
    if (status.status === "unauthenticated") {
      if (serverUrl !== undefined) {
        const configured = await run(["config", "server", serverUrl]);
        if (configured.code !== 0) failed(configured);
      }
      const login = await run(["login", "--apikey"], { env: { BW_CLIENTID: creds.clientId, BW_CLIENTSECRET: creds.clientSecret } });
      if (login.code !== 0) fail(authError(`bw login --apikey: ${bwMessage(login)}`));
    }
    const unlocked = await run(["unlock", "--passwordenv", "BW_MASTER_PASSWORD", "--raw"], { env: { BW_MASTER_PASSWORD: creds.masterPassword } });
    const key = unlocked.stdout.trim();
    if (unlocked.code !== 0 || key === "") fail(authError(`bw unlock: ${bwMessage(unlocked)}`));
    return key;
  };

  /** Run with the session, unlocking first if needed, and once more if the CLI says the session is gone. */
  const withSession = async (args: readonly string[], input?: string): Promise<BwResult> => {
    for (let attempt = 0; ; attempt++) {
      session ??= await unlock();
      const result = await run(args, { env: { BW_SESSION: session }, ...(input === undefined ? {} : { input }) });
      if (result.code === 0 || attempt > 0 || !SESSION_GONE.test(bwMessage(result))) return result;
      session = undefined;
    }
  };

  /** A login or a secure note to read; a login only, to edit. */
  const getItem = async (id: string, use: "read" | "edit" = "read") => {
    checkId(id);
    const result = await withSession(["get", "item", id]);
    if (result.code !== 0 && /not found/i.test(bwMessage(result))) return fail(notFound(`no item ${id}`));
    const item = parsed(result, itemWire);
    if (item.type === LOGIN_TYPE || (use === "read" && item.type === SECURE_NOTE_TYPE)) return item;
    if (item.type === SECURE_NOTE_TYPE) return fail(inputError(`item ${id} is a secure note: this server reads notes and edits logins only`));
    return fail(notFound(`item ${id} is not a login or a secure note`));
  };

  /** The base64 JSON `bw create` and `bw edit` read; it goes in on stdin, like every payload here. */
  const encoded = (payload: unknown): string => Buffer.from(JSON.stringify(payload), "utf8").toString("base64");

  const collections = memoize(LISTS_TTL_MS, async (_all: "all") =>
    parsed(await withSession(["list", "collections"]), collectionWire.array()).map(collectionOf),
  );
  const organizations = memoize(LISTS_TTL_MS, async (_all: "all") =>
    parsed(await withSession(["list", "organizations"]), organizationWire.array()).map(organizationOf),
  );

  return {
    status: async () => {
      session ??= await unlock();
      return statusOf(parsed(await run(["status"], { env: { BW_SESSION: session } }), statusWire));
    },
    sync: async (options) => {
      if (options?.force !== true && now() - lastSyncAt < SYNC_EVERY_MS) return;
      const result = await withSession(["sync"]);
      if (result.code !== 0) failed(result);
      lastSyncAt = now();
    },
    listLogins: async (filter) => {
      const args = ["list", "items", ...(filter.search ? ["--search", filter.search] : []), ...(filter.url ? ["--url", filter.url] : [])];
      return parsed(await withSession(args), itemWire.array())
        .filter((item) => item.type === LOGIN_TYPE || item.type === SECURE_NOTE_TYPE)
        .map(loginOf);
    },
    getLogin: async (id) => loginOf(await getItem(id)),
    createLogin: async (draft: LoginDraft) => loginOf(parsed(await withSession(["create", "item"], encoded(itemPayload(draft))), itemWire)),
    editLogin: async (id, draft) => {
      const base = await getItem(id, "edit");
      return loginOf(parsed(await withSession(["edit", "item", id], encoded(itemPayload(draft, base))), itemWire));
    },
    createNote: async (draft: NoteDraft) => loginOf(parsed(await withSession(["create", "item"], encoded(notePayload(draft))), itemWire)),
    // `bw edit item-collections <id>` takes a JSON array of collection ids and no --organizationid (CLI 2026.10.0
    // reads that option for org-collection only). It prints the item, but goes through the SDK and clears the CLI's
    // cache on the way, so the use case reads the item back after a forced sync rather than trusting that answer.
    moveItem: async (id, collectionIds) => {
      checkId(id);
      const result = await withSession(["edit", "item-collections", id], encoded(collectionIds));
      if (result.code !== 0 && /not found/i.test(bwMessage(result))) return fail(notFound(`no item ${id}`));
      if (result.code !== 0) failed(result);
    },
    collections: () => collections("all"),
    organizations: () => organizations("all"),
  };
};
