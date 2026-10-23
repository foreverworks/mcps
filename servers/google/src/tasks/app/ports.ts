/** What the Tasks use cases need, named as operations. No URL appears above infra/. */
import type { Grant } from "../../grants/grant.js";
import type { RawTask, RawTaskList } from "../domain/schema.js";

export type TaskQuery = {
  readonly includeCompleted: boolean;
  /** RFC 3339 bounds on the due date, as the API filters it. */
  readonly dueMin?: string;
  readonly dueMax?: string;
  /** Stop reading once this many have come. */
  readonly limit: number;
};

/** Where a task goes among its siblings: under `parent` (top level when absent), after `previous` (first when absent). */
export type Placement = { readonly parent?: string; readonly previous?: string };

export type TasksPort = {
  readonly lists: () => Promise<readonly RawTaskList[]>;
  /** The account's default list, which "@default" names. */
  readonly defaultList: () => Promise<RawTaskList>;
  /** One list's tasks, in Google's order, every page up to the limit; `more` when the limit cut it short. */
  readonly tasks: (listId: string, query: TaskQuery) => Promise<{ readonly items: readonly RawTask[]; readonly more: boolean }>;
  readonly get: (listId: string, taskId: string) => Promise<RawTask>;
  /** Never retried: a second attempt could make a second task. */
  readonly insert: (listId: string, body: Record<string, unknown>, placement: Placement) => Promise<RawTask>;
  readonly patch: (listId: string, taskId: string, body: Record<string, unknown>) => Promise<RawTask>;
  readonly move: (listId: string, taskId: string, placement: Placement & { readonly destinationList?: string }) => Promise<RawTask>;
  readonly insertList: (title: string) => Promise<RawTaskList>;
  /** One cheap read that proves the API answers. */
  readonly probe: () => Promise<unknown>;
};

export type Deps = {
  readonly grant: Grant;
  readonly tasks: TasksPort;
};
