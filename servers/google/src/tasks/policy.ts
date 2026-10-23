import type { ToolPolicy } from "@foreverworks/mcp-kit";

/**
 * Google Tasks' tools. complete_task and update_task read the task first and
 * send only what differs, so a repeat changes nothing: idempotent
 * (test/tasks/tasks.test.ts holds them to it). A move or a create is not.
 */
export const TASKS: ToolPolicy = {
  list_task_lists: { access: "read" },
  list_tasks: { access: "read" },
  create_task: { access: "write" },
  update_task: { access: "write", idempotent: true },
  complete_task: { access: "write", idempotent: true },
  move_task: { access: "write" },
  create_task_list: { access: "write" },
};
