import type { Parsed } from "./plan.js";

/**
 * The OAuth client file Google Cloud's console downloads, checked before
 * setup keeps it. Pure.
 *
 * A Desktop app client downloads as `client_secret_<id>.json` holding one
 * `installed` block with `client_id`, `client_secret` and `project_id`. A
 * Web application client downloads with a `web` block instead, and Google
 * refuses its loopback redirect, so setup refuses it before any consent.
 */
export type ClientFile = { readonly clientId: string; readonly projectId?: string };

/** What Google names the file it downloads; a second download of it gets ` (1)` before `.json`. */
export const isClientFileName = (name: string): boolean => /^client_secret_.+\.json$/.test(name);

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** The client in a downloaded file's parsed JSON, or why it is not one setup can use. */
export const checkClientFile = (raw: unknown): Parsed<ClientFile> => {
  if (raw === null || typeof raw !== "object") return { problem: "it is not an OAuth client file (not a JSON object)" };
  const file = raw as Record<string, unknown>;
  if (file["web"] !== undefined && file["installed"] === undefined) {
    return { problem: "it is a Web application client; create a client of type Desktop app instead" };
  }
  const block = file["installed"];
  if (block === null || typeof block !== "object") return { problem: "it holds no Desktop app client (no `installed` block)" };
  const installed = block as Record<string, unknown>;
  const clientId = text(installed["client_id"]);
  const missing = [clientId ? [] : ["client_id"], text(installed["client_secret"]) ? [] : ["client_secret"]].flat();
  if (missing.length > 0 || !clientId) return { problem: `its Desktop app client lacks ${missing.join(" and ")}` };
  const projectId = text(installed["project_id"]);
  return { ok: { clientId, ...(projectId ? { projectId } : {}) } };
};
