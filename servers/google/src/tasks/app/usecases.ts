import { unlessCancelled } from "@foreverworks/mcp-kit";

import { grantHealth } from "../../grants/health.js";
import { describeThrown, fail, inputError, remedyFor } from "../domain/errors.js";
import { REQUIRED_SCOPES } from "../domain/grants.js";
import type { RawTaskList } from "../domain/schema.js";
import { completionChange, daysOf, dueBetween, dueOf, listName, newTaskBody, parseDate, type TaskFields, taskChanges, taskView } from "../domain/tasks.js";
import type { Deps, Placement } from "./ports.js";

/** The id Google Tasks gives every account's default list, whatever it is called. */
export const DEFAULT_LIST = "@default";

/** Per account, the most tasks one read returns. */
export const MAX_TASKS = 1000;

/** The list a task id lives in, named for results; one the account does not list is named by its id. */
const listOf = async (deps: Deps, listId: string): Promise<RawTaskList> => {
  if (listId === DEFAULT_LIST) return deps.tasks.defaultList();
  const lists = await deps.tasks.lists();
  return lists.find((l) => l.id === listId) ?? { id: listId };
};

export const listTaskLists = async (accounts: readonly Deps[]) =>
  Promise.all(
    accounts.map(async (deps) => {
      try {
        // The default list's own id is opaque, so the result says which one "@default" is.
        const [lists, fallback] = await Promise.all([deps.tasks.lists(), deps.tasks.defaultList()]);
        return {
          account: deps.grant.account,
          lists: lists.map((l) => ({ taskListId: l.id ?? "", title: listName(l), ...(l.id === fallback.id ? { default: true } : {}), ...(l.updated ? { updated: l.updated } : {}) })),
        };
      } catch (thrown) {
        unlessCancelled("the lists stopped before every account was read");
        return { account: deps.grant.account, error: describeThrown(thrown) };
      }
    }),
  );

export type ListRequest = {
  /** A list id, "@default", or "" for every list. */
  readonly taskList: string;
  readonly includeCompleted: boolean;
  /** YYYY-MM-DD, inclusive; "" for no bound. */
  readonly dueFrom: string;
  readonly dueTo: string;
  readonly limit: number;
};

/**
 * Tasks across accounts and lists, each tagged with what a write needs
 * (account, taskListId, taskId). One dead account or list is reported beside
 * the tasks that did arrive.
 */
export const listTasks = async (accounts: readonly Deps[], request: ListRequest) => {
  const first = request.dueFrom ? parseDate(request.dueFrom, "due_from") : undefined;
  const last = request.dueTo ? parseDate(request.dueTo, "due_to") : undefined;
  if (first && last && last < first) return fail(inputError(`due_to (${last}) is before due_from (${first})`));
  const results = await Promise.all(
    accounts.map(async (deps) => {
      try {
        // A list id belongs to one account: across several, only the account that has it is read.
        const named = request.taskList !== "" && request.taskList !== DEFAULT_LIST;
        const lists =
          request.taskList === ""
            ? await deps.tasks.lists()
            : named && accounts.length > 1
              ? (await deps.tasks.lists()).filter((l) => l.id === request.taskList)
              : [await listOf(deps, request.taskList)];
        const read = await Promise.all(
          lists.map((list) =>
            deps.tasks.tasks(list.id ?? DEFAULT_LIST, {
              includeCompleted: request.includeCompleted,
              ...(first ? { dueMin: dueOf(first) } : {}),
              // The API's upper bound is a timestamp; the day after's midnight covers the whole last day, and the filter below keeps exactly the days asked.
              ...(last ? { dueMax: dueOf(nextDay(last)) } : {}),
              limit: request.limit,
            }),
          ),
        );
        const tasks = read
          .flatMap(({ items }, i) => items.filter((t) => !t.deleted && (!(first || last) || dueBetween(t, first ?? "0000-01-01", last ?? "9999-12-31"))).map((t) => taskView(deps.grant.account, lists[i] ?? {}, t)))
          .slice(0, request.limit);
        const cut = read.some((r) => r.more) || tasks.length === request.limit;
        return { account: deps.grant.account, tasks, ...(cut ? { truncated: true } : {}) };
      } catch (thrown) {
        unlessCancelled("the tasks stopped before every account was read");
        return { account: deps.grant.account, error: describeThrown(thrown) };
      }
    }),
  );
  return {
    tasks: results.flatMap((r) => ("tasks" in r ? r.tasks : [])),
    ...(results.some((r) => "truncated" in r) ? { truncated: `some account had more than ${request.limit}; narrow by list or due dates, or raise limit` } : {}),
    ...(results.some((r) => "error" in r) ? { failures: results.flatMap((r) => ("error" in r ? [{ account: r.account, error: r.error }] : [])) } : {}),
  };
};

const nextDay = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Tasks not yet done that fall due inside an agenda window, from every
 * account given, sorted by day. A task in Google Tasks has a due DATE, never a
 * time, so the agenda lists it by day beside the events rather than among them.
 */
export const tasksDue = async (accounts: readonly Deps[], window: { readonly timeMin: string; readonly timeMax: string; readonly timeZone: string }) => {
  const { first, last } = daysOf(window.timeMin, window.timeMax, window.timeZone);
  const listed = await listTasks(accounts, { taskList: "", includeCompleted: false, dueFrom: first, dueTo: last, limit: MAX_TASKS });
  return { ...listed, tasks: [...listed.tasks].sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "")) };
};

export const createTask = async (deps: Deps, listId: string, fields: TaskFields, placement: Placement) => {
  const body = newTaskBody(fields);
  const list = await listOf(deps, listId);
  const made = await deps.tasks.insert(listId, body, placement);
  return { created: taskView(deps.grant.account, list, made) };
};

/** Only what differs is sent; asked twice with the same values, the second call changes nothing and says so. */
export const updateTask = async (deps: Deps, listId: string, taskId: string, fields: TaskFields) => {
  const [list, existing] = await Promise.all([listOf(deps, listId), deps.tasks.get(listId, taskId)]);
  const changes = taskChanges(fields, existing);
  if (Object.keys(changes).length === 0) return { unchanged: true, task: taskView(deps.grant.account, list, existing) };
  const updated = await deps.tasks.patch(listId, taskId, changes);
  return { updated: taskView(deps.grant.account, list, updated), changed: Object.keys(changes) };
};

/** Done, or open again. A task already in that state is left alone, so a repeat sends nothing. */
export const completeTask = async (deps: Deps, listId: string, taskId: string, completed: boolean) => {
  const [list, existing] = await Promise.all([listOf(deps, listId), deps.tasks.get(listId, taskId)]);
  const change = completionChange(existing, completed);
  if (change === undefined) return { unchanged: true, task: taskView(deps.grant.account, list, existing) };
  const updated = await deps.tasks.patch(listId, taskId, change);
  return { [completed ? "completed" : "reopened"]: taskView(deps.grant.account, list, updated) };
};

export const moveTask = async (deps: Deps, listId: string, taskId: string, placement: Placement & { readonly destinationList?: string }) => {
  if (placement.parent !== undefined && placement.parent === taskId) return fail(inputError("a task cannot be its own parent"));
  const target = placement.destinationList ?? listId;
  const moved = await deps.tasks.move(listId, taskId, placement);
  const list = await listOf(deps, target);
  return { moved: taskView(deps.grant.account, list, moved) };
};

export const createTaskList = async (deps: Deps, title: string) => {
  const name = title.trim();
  if (!name) return fail(inputError("a list needs a title"));
  const made = await deps.tasks.insertList(name);
  return { created: { account: deps.grant.account, taskListId: made.id ?? "", title: listName(made) } };
};

export const checkHealth = (deps: Deps) => grantHealth(deps.grant, { required: REQUIRED_SCOPES, probe: deps.tasks.probe, remedyFor });
