import { readFile } from "node:fs/promises";

import { withFileLock, writeJsonFile } from "@foreverworks/mcp-kit";

import type { Paths, SessionStorePort } from "../app/ports.js";
import { type Json, record } from "../domain/json.js";
import { sessionBook, storedSession } from "../domain/sessions.js";
import { withEntry, withoutEntry } from "../domain/sessionsFile.js";

type OnDisk =
  | { readonly state: "absent" }
  | { readonly state: "ok"; readonly file: Json }
  /** Present but not a JSON object: nothing in it is usable, and all of it is kept aside. */
  | { readonly state: "unreadable"; readonly text: string };

const load = async (path: string): Promise<OnDisk> => {
  const text = await readFile(path, "utf8").catch((cause: NodeJS.ErrnoException) => {
    if (cause.code === "ENOENT") return undefined;
    throw cause;
  });
  if (text === undefined) return { state: "absent" };
  try {
    const file = record(JSON.parse(text) as unknown);
    return file === undefined ? { state: "unreadable", text } : { state: "ok", file };
  } catch {
    return { state: "unreadable", text };
  }
};

const fileOf = (disk: OnDisk): Json => (disk.state === "ok" ? disk.file : {});

/**
 * sessions.json, in the one format domain/sessionsFile.ts defines, which other
 * programs may read.
 *
 * What is stored here cannot be recovered from anywhere else: Enable Banking
 * reveals a session_id once, and getting another means a person repeating SCA
 * in a bank app. So a save is read-modify-write under a cross-process lock, then
 * an atomic rename at 0600, both from @foreverworks/mcp-kit. Before it, the file
 * as it was is copied to sessions.json.bak, so
 * the consent a renewal replaces is one rename away. Every label other than the
 * one written is carried over as parsed, whatever shape it has.
 *
 * A file that exists but is not a JSON object reads as empty rather than fatal
 * (refusing would also block the complete_auth that repairs it). Its text is
 * kept, as a JSON string, in sessions.json.unreadable-<ms> before the first
 * write, so the `.bak` of the next consent cannot overwrite the only copy.
 *
 * @param now milliseconds, for the name of that copy.
 */
export const makeSessionStore = (paths: Paths, now: () => number = Date.now): SessionStorePort => {
  /** Copy the file as it was aside, and say where; nothing to copy when there was no file. */
  const keepAside = async (disk: OnDisk): Promise<string | undefined> => {
    switch (disk.state) {
      case "absent":
        return undefined;
      case "ok":
        await writeJsonFile(paths.backup, disk.file);
        return paths.backup;
      case "unreadable": {
        const path = `${paths.sessions}.unreadable-${now()}`;
        await writeJsonFile(path, disk.text);
        return path;
      }
    }
  };

  return {
    read: async () => sessionBook(fileOf(await load(paths.sessions))),

    save: (label, entry) =>
      withFileLock(paths.stateDir, "sessions.lock", async () => {
        const before = await load(paths.sessions);
        const backup = await keepAside(before);
        const file = fileOf(before);
        await writeJsonFile(paths.sessions, withEntry(file, label, entry));
        return { backup, replaced: storedSession(label, file[label]) };
      }),

    remove: (label) =>
      withFileLock(paths.stateDir, "sessions.lock", async () => {
        const before = await load(paths.sessions);
        const file = fileOf(before);
        if (!(label in file)) return {};
        const backup = await keepAside(before);
        await writeJsonFile(paths.sessions, withoutEntry(file, label));
        return { backup, replaced: storedSession(label, file[label]) };
      }),
  };
};
