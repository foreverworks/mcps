import { fail, inputError } from "./errors.js";
import type { RawTask, RawTaskList } from "./schema.js";

/**
 * Tasks as Google Tasks keeps them, and as this server hands them on. Pure.
 *
 * A task's due is a DATE: the API stores midnight UTC and discards any time
 * it is sent ("It isn't possible to read or write the time that a task is
 * scheduled for using the API"), so this server speaks YYYY-MM-DD both ways
 * and never invents a time of day.
 */

export type TaskView = {
  readonly account: string;
  readonly taskListId: string;
  readonly list: string;
  readonly taskId: string;
  readonly title: string;
  readonly status: "needsAction" | "completed";
  readonly due?: string;
  readonly notes?: string;
  readonly completed?: string;
  /** The task this one is a subtask of. */
  readonly parent?: string;
  readonly link?: string;
  readonly updated?: string;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD that names a real day, or a refusal saying why not. */
export const parseDate = (text: string, what: string): string => {
  const date = text.trim();
  const day = DATE.test(date) ? new Date(`${date}T00:00:00Z`) : undefined;
  // A month 13 is an Invalid Date, and Feb 30 rolls over to March: both are refused here, as input.
  if (day === undefined || Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== date) {
    return fail(inputError(`${what} must be a date, YYYY-MM-DD (Google Tasks keeps no time of day): "${text}"`));
  }
  return date;
};

/** The due date as the API takes it: that day at midnight UTC. */
export const dueOf = (date: string): string => `${date}T00:00:00.000Z`;

/** The day a stored due names. The API sends midnight UTC, so its date part is the day. */
export const dateOfDue = (due: string | null | undefined): string | undefined => (due ? due.slice(0, 10) : undefined);

export const listName = (list: RawTaskList | undefined): string => list?.title ?? list?.id ?? "(unnamed list)";

export const taskView = (account: string, list: RawTaskList, task: RawTask): TaskView => {
  const due = dateOfDue(task.due);
  return {
    account,
    taskListId: list.id ?? "",
    list: listName(list),
    taskId: task.id ?? "",
    title: task.title || "(no title)",
    status: task.status === "completed" ? "completed" : "needsAction",
    ...(due ? { due } : {}),
    ...(task.notes ? { notes: task.notes } : {}),
    ...(task.completed ? { completed: task.completed } : {}),
    ...(task.parent ? { parent: task.parent } : {}),
    ...(task.webViewLink ? { link: task.webViewLink } : {}),
    ...(task.updated ? { updated: task.updated } : {}),
  };
};

/** The day an instant falls on in a zone, as YYYY-MM-DD. */
const dayIn = (epochMs: number, timeZone: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(epochMs);

/**
 * The days an agenda window covers, for tasks due in it: from the day its
 * start falls on to the day its last instant does, both inclusive, in the
 * calendar's zone. A task due on one of them is in the agenda.
 */
export const daysOf = (timeMin: string, timeMax: string, timeZone: string): { readonly first: string; readonly last: string } => ({
  first: dayIn(Date.parse(timeMin), timeZone),
  last: dayIn(Date.parse(timeMax) - 1, timeZone),
});

export const dueBetween = (task: RawTask, first: string, last: string): boolean => {
  const day = dateOfDue(task.due);
  return day !== undefined && day >= first && day <= last;
};

export type TaskFields = {
  readonly title?: string;
  readonly notes?: string;
  /** YYYY-MM-DD; "" clears it. */
  readonly due?: string;
};

/** A new task's body: a title, and only what else was given. */
export const newTaskBody = (fields: TaskFields): Record<string, unknown> => {
  const title = fields.title?.trim();
  if (!title) return fail(inputError("a task needs a title"));
  return {
    title,
    ...(fields.notes ? { notes: fields.notes } : {}),
    ...(fields.due ? { due: dueOf(parseDate(fields.due, "due")) } : {}),
  };
};

/**
 * The PATCH for an existing task: only the fields given that differ from what
 * it holds, so calling it again with the same values sends nothing. An empty
 * notes or due clears it.
 */
export const taskChanges = (fields: TaskFields, existing: RawTask): Record<string, unknown> => {
  const changes: Record<string, unknown> = {};
  if (fields.title !== undefined) {
    const title = fields.title.trim();
    if (!title) return fail(inputError("a task's title cannot be empty"));
    if (title !== (existing.title ?? "")) changes["title"] = title;
  }
  if (fields.notes !== undefined && fields.notes !== (existing.notes ?? "")) changes["notes"] = fields.notes === "" ? null : fields.notes;
  if (fields.due !== undefined) {
    const day = fields.due.trim() === "" ? undefined : parseDate(fields.due, "due");
    if (day !== dateOfDue(existing.due)) changes["due"] = day === undefined ? null : dueOf(day);
  }
  return changes;
};

/** The PATCH that completes a task or reopens it, or undefined when it is already so. */
export const completionChange = (existing: RawTask, completed: boolean): Record<string, unknown> | undefined => {
  if ((existing.status === "completed") === completed) return undefined;
  return completed ? { status: "completed" } : { status: "needsAction", completed: null };
};
