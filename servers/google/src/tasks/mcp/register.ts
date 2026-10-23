import type { McpServer } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { readAccountArg, writeAccountArg } from "../../grants/args.js";
import { completeTask, createTask, createTaskList, DEFAULT_LIST, listTaskLists, listTasks, MAX_TASKS, moveTask, updateTask } from "../app/usecases.js";
import type { Registry } from "../composition.js";
import { handled } from "./envelope.js";

const listArg = () =>
  z.string().min(1).default(DEFAULT_LIST).describe(`The list's taskListId from list_task_lists or list_tasks; "${DEFAULT_LIST}" (the default) is the account's default list.`);
const taskArg = () => z.string().min(1).describe("The taskId from list_tasks.");
const dateArg = (what: string) => z.string().optional().describe(`${what}: YYYY-MM-DD. Google Tasks keeps a date only, never a time of day.`);

type Target = { account: string; task_list: string; task_id: string };

/** Google Tasks: lists and tasks, read across every account, written in one named account. */
export const registerAll = (server: McpServer, registry: Registry): void => {
  server.registerTool(
    "list_task_lists",
    {
      title: "List task lists",
      description: "Every Google Tasks list of each account (every account by default), with the taskListId the other task tools take; the default list is marked.",
      inputSchema: { account: readAccountArg() },
    },
    handled(async (a: { account: string }) => ({ accounts: await listTaskLists(registry.select(a.account)) })),
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List tasks",
      description:
        "Tasks across every account by default, from every list unless task_list names one, in each list's own order. " +
        "Open tasks only unless include_completed. due_from and due_to keep the tasks due between those dates (inclusive), " +
        "which leaves out tasks with no due date. Each task carries account, taskListId and taskId for the write tools, " +
        "parent when it is a subtask, and its link in Google Tasks. agenda with include_tasks shows the tasks due beside the events.",
      inputSchema: {
        account: readAccountArg(),
        task_list: z.string().default("").describe(`A taskListId, "${DEFAULT_LIST}" for the default list, or empty (the default) for every list.`),
        include_completed: z.boolean().default(false),
        due_from: z.string().default("").describe("YYYY-MM-DD, inclusive."),
        due_to: z.string().default("").describe("YYYY-MM-DD, inclusive."),
        limit: z.number().int().min(1).max(MAX_TASKS).default(200).describe("Per account."),
      },
    },
    handled((a: { account: string; task_list: string; include_completed: boolean; due_from: string; due_to: string; limit: number }) =>
      listTasks(registry.select(a.account), { taskList: a.task_list, includeCompleted: a.include_completed, dueFrom: a.due_from, dueTo: a.due_to, limit: a.limit }),
    ),
  );

  server.registerTool(
    "create_task",
    {
      title: "Create task",
      description:
        "Add a task to one account's list. Needs a title; notes and a due date are optional. parent makes it a subtask of " +
        "another task in the same list; previous places it after that sibling (first otherwise).",
      inputSchema: {
        account: writeAccountArg(),
        task_list: listArg(),
        title: z.string().min(1),
        notes: z.string().optional(),
        due: dateArg("The day it is due"),
        parent: z.string().optional().describe("A taskId in the same list: the new task becomes its subtask."),
        previous: z.string().optional().describe("A sibling's taskId: the new task goes right after it."),
      },
    },
    handled((a: { account: string; task_list: string; title: string; notes?: string | undefined; due?: string | undefined; parent?: string | undefined; previous?: string | undefined }) =>
      createTask(
        registry.get(a.account),
        a.task_list,
        { title: a.title, ...(a.notes !== undefined ? { notes: a.notes } : {}), ...(a.due !== undefined ? { due: a.due } : {}) },
        { ...(a.parent ? { parent: a.parent } : {}), ...(a.previous ? { previous: a.previous } : {}) },
      ),
    ),
  );

  server.registerTool(
    "update_task",
    {
      title: "Update task",
      description:
        "Change a task's title, notes or due date. Only the fields given change, and only when they differ: an empty notes " +
        "or due clears it. To mark it done use complete_task; to move it, move_task.",
      inputSchema: {
        account: writeAccountArg(),
        task_list: listArg(),
        task_id: taskArg(),
        title: z.string().optional(),
        notes: z.string().optional().describe('New notes; "" clears them.'),
        due: z.string().optional().describe('YYYY-MM-DD, or "" to clear the due date.'),
      },
    },
    handled((a: Target & { title?: string | undefined; notes?: string | undefined; due?: string | undefined }) =>
      updateTask(registry.get(a.account), a.task_list, a.task_id, {
        ...(a.title !== undefined ? { title: a.title } : {}),
        ...(a.notes !== undefined ? { notes: a.notes } : {}),
        ...(a.due !== undefined ? { due: a.due } : {}),
      }),
    ),
  );

  server.registerTool(
    "complete_task",
    {
      title: "Complete task",
      description: "Mark a task done, or open again with completed: false. A task already in that state is left as it is.",
      inputSchema: { account: writeAccountArg(), task_list: listArg(), task_id: taskArg(), completed: z.boolean().default(true) },
    },
    handled((a: Target & { completed: boolean }) => completeTask(registry.get(a.account), a.task_list, a.task_id, a.completed)),
  );

  server.registerTool(
    "move_task",
    {
      title: "Move task",
      description:
        "Move a task: under parent (a subtask; top level when omitted), after previous (first among its siblings when " +
        "omitted), and into another list of the same account with to_list. A repeating task cannot change lists.",
      inputSchema: {
        account: writeAccountArg(),
        task_list: listArg(),
        task_id: taskArg(),
        parent: z.string().optional().describe("The taskId it goes under; omit for the top level."),
        previous: z.string().optional().describe("The sibling taskId it goes after; omit for the first position."),
        to_list: z.string().optional().describe("Another taskListId of the same account to move it into."),
      },
    },
    handled((a: Target & { parent?: string | undefined; previous?: string | undefined; to_list?: string | undefined }) =>
      moveTask(registry.get(a.account), a.task_list, a.task_id, {
        ...(a.parent ? { parent: a.parent } : {}),
        ...(a.previous ? { previous: a.previous } : {}),
        ...(a.to_list ? { destinationList: a.to_list } : {}),
      }),
    ),
  );

  server.registerTool(
    "create_task_list",
    {
      title: "Create task list",
      description: "A new Google Tasks list in one account; returns its taskListId.",
      inputSchema: { account: writeAccountArg(), title: z.string().min(1) },
    },
    handled((a: { account: string; title: string }) => createTaskList(registry.get(a.account), a.title)),
  );
};
