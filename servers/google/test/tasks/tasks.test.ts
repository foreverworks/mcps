/** Google Tasks against a fake port and a recording request layer. Invented data only. */
import { idempotentWrites } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import type { Deps, TasksPort } from "../../src/tasks/app/ports.js";
import { completeTask, createTask, listTaskLists, listTasks, moveTask, tasksDue, updateTask } from "../../src/tasks/app/usecases.js";
import { daysOf, parseDate, taskChanges } from "../../src/tasks/domain/tasks.js";
import type { RawTask, RawTaskList } from "../../src/tasks/domain/schema.js";
import { makeTasksApi } from "../../src/tasks/infra/tasksApi.js";
import { TASKS } from "../../src/tasks/policy.js";
import type { Request, RequestSpec } from "../../src/infra/httpJson.js";
import { asAppError, type AppError, authError, fail } from "../../src/tasks/domain/errors.js";

const failure = async (promise: Promise<unknown>): Promise<AppError> => {
  const thrown: unknown = await promise.then(
    () => undefined,
    (t: unknown) => t,
  );
  const error = asAppError(thrown);
  if (!error) throw new Error(`expected a failure, got ${JSON.stringify(thrown)}`);
  return error;
};

const fake = (account: string, lists: RawTaskList[], tasks: Record<string, RawTask[]>, broken = false) => {
  const writes: { op: string; listId: string; body?: unknown; extra?: unknown }[] = [];
  const port: TasksPort = {
    lists: async () => {
      if (broken) return fail(authError("invalid_grant", "revoked"));
      return lists;
    },
    defaultList: async () => lists[0] ?? { id: "@default" },
    tasks: async (listId, q) => ({ items: (tasks[listId] ?? []).filter((t) => q.includeCompleted || t.status !== "completed"), more: false }),
    get: async (listId, taskId) => {
      const found = (tasks[listId] ?? []).find((t) => t.id === taskId);
      if (!found) throw new Error(`no task ${taskId}`);
      return found;
    },
    insert: async (listId, body, placement) => (writes.push({ op: "insert", listId, body, extra: placement }), { id: "new", ...(body as object) }),
    patch: async (listId, taskId, body) => {
      writes.push({ op: "patch", listId, body });
      const list = tasks[listId] ?? [];
      const i = list.findIndex((t) => t.id === taskId);
      list[i] = { ...list[i], ...(body as object) } as RawTask;
      return list[i] as RawTask;
    },
    move: async (listId, taskId, placement) => (writes.push({ op: "move", listId, extra: placement }), { id: taskId, title: "moved" }),
    insertList: async (title) => ({ id: "L-new", title }),
    probe: async () => ({}),
  };
  const deps: Deps = { grant: { account, credentials: `/creds/${account}.json`, scopes: async () => [], whoami: async () => undefined }, tasks: port };
  return { deps, writes };
};

const home: RawTaskList = { id: "L1", title: "My Tasks" };
const errands: RawTaskList = { id: "L2", title: "Errands" };

describe("the task rules", () => {
  it("speaks dates, as Google Tasks keeps them, and refuses a day that does not exist", () => {
    expect(parseDate("2026-10-31", "due")).toBe("2026-10-31");
    expect(() => parseDate("2026-02-30", "due")).toThrow();
    expect(() => parseDate("2026-10-31T09:00", "due")).toThrow();
    // An impossible month is a tagged input refusal, not an internal error.
    for (const bad of ["2026-13-01", "2026-01-32", "2026-00-10"]) {
      let thrown: unknown;
      try {
        parseDate(bad, "due");
      } catch (t) {
        thrown = t;
      }
      expect(asAppError(thrown)).toMatchObject({ kind: "input" });
    }
  });

  it("covers the days an agenda window falls on, in the calendar's zone", () => {
    // 22:00Z on the 21st is already the 22nd in Bucharest; the window's last instant is late on the 23rd there.
    expect(daysOf("2026-10-21T21:00:00Z", "2026-10-23T21:00:00Z", "Europe/Bucharest")).toEqual({ first: "2026-10-22", last: "2026-10-23" });
  });

  it("sends only what differs, and clears notes or a due date with an empty string", () => {
    const existing: RawTask = { id: "t", title: "Pay rent", notes: "by transfer", due: "2026-11-01T00:00:00.000Z" };
    expect(taskChanges({ title: "Pay rent", notes: "by transfer", due: "2026-11-01" }, existing)).toEqual({});
    expect(taskChanges({ notes: "", due: "" }, existing)).toEqual({ notes: null, due: null });
    expect(taskChanges({ due: "2026-11-02" }, existing)).toEqual({ due: "2026-11-02T00:00:00.000Z" });
  });
});

describe("reading tasks", () => {
  it("reads every list of every account, tags each task for the write tools, and keeps a dead account apart", async () => {
    const personal = fake("personal", [home, errands], {
      L1: [{ id: "a", title: "Call Ana", due: "2026-10-22T00:00:00.000Z" }],
      L2: [{ id: "b", title: "Buy stamps" }, { id: "c", title: "Old", status: "completed" }],
    });
    const work = fake("work", [], {}, true);
    const out = await listTasks([personal.deps, work.deps], { taskList: "", includeCompleted: false, dueFrom: "", dueTo: "", limit: 200 });
    expect(out.tasks).toEqual([
      expect.objectContaining({ account: "personal", taskListId: "L1", list: "My Tasks", taskId: "a", title: "Call Ana", due: "2026-10-22", status: "needsAction" }),
      expect.objectContaining({ account: "personal", taskListId: "L2", taskId: "b", title: "Buy stamps" }),
    ]);
    expect(out.failures).toEqual([{ account: "work", error: expect.stringContaining("invalid_grant") }]);
  });

  it("reads a named list only in the account that has it, without a failure from the others", async () => {
    const personal = fake("personal", [home], { L1: [{ id: "a", title: "Call Ana" }] });
    const work = fake("work", [{ id: "W1", title: "Work" }], { W1: [{ id: "w", title: "Report" }] });
    const out = await listTasks([personal.deps, work.deps], { taskList: "W1", includeCompleted: false, dueFrom: "", dueTo: "", limit: 200 });
    expect(out.tasks.map((t) => `${t.account} ${t.taskId}`)).toEqual(["work w"]);
    expect(out).not.toHaveProperty("failures");
  });

  it("keeps only tasks due between the dates, which leaves out those with no date", async () => {
    const { deps } = fake("personal", [home], {
      L1: [
        { id: "a", title: "Before", due: "2026-10-20T00:00:00.000Z" },
        { id: "b", title: "In", due: "2026-10-23T00:00:00.000Z" },
        { id: "c", title: "Undated" },
        { id: "d", title: "Last day", due: "2026-10-24T00:00:00.000Z" },
      ],
    });
    const out = await listTasks([deps], { taskList: "", includeCompleted: false, dueFrom: "2026-10-22", dueTo: "2026-10-24", limit: 200 });
    expect(out.tasks.map((t) => t.taskId)).toEqual(["b", "d"]);
  });

  it("gives the agenda the open tasks due on its days, by day", async () => {
    const { deps } = fake("work", [home, errands], {
      L1: [{ id: "late", title: "Report", due: "2026-10-23T00:00:00.000Z" }],
      L2: [{ id: "soon", title: "Invoice", due: "2026-10-22T00:00:00.000Z" }, { id: "x", title: "Next week", due: "2026-10-30T00:00:00.000Z" }],
    });
    const out = await tasksDue([deps], { timeMin: "2026-10-21T21:00:00Z", timeMax: "2026-10-23T21:00:00Z", timeZone: "Europe/Bucharest" });
    expect(out.tasks.map((t) => t.taskId)).toEqual(["soon", "late"]);
  });
});

describe("the default list", () => {
  it("is the one Google names @default, wherever it sits in the list of lists", async () => {
    const { deps } = fake("personal", [errands, home], {});
    const port = { ...deps.tasks, defaultList: async () => home };
    const out = await listTaskLists([{ ...deps, tasks: port }]);
    expect(out[0]).toEqual({ account: "personal", lists: [{ taskListId: "L2", title: "Errands" }, { taskListId: "L1", title: "My Tasks", default: true }] });
  });
});

describe("writing tasks", () => {
  it("creates a task with only what was given, placed as asked", async () => {
    const { deps, writes } = fake("personal", [home], { L1: [] });
    await createTask(deps, "@default", { title: " Call Ana ", due: "2026-10-25" }, { parent: "p1" });
    expect(writes).toEqual([{ op: "insert", listId: "@default", body: { title: "Call Ana", due: "2026-10-25T00:00:00.000Z" }, extra: { parent: "p1" } }]);
    expect(await failure(createTask(deps, "@default", { title: "  " }, {}))).toMatchObject({ kind: "input" });
  });

  it("refuses to make a task its own parent before sending anything", async () => {
    const { deps, writes } = fake("personal", [home], { L1: [{ id: "a", title: "A" }] });
    expect(await failure(moveTask(deps, "L1", "a", { parent: "a" }))).toMatchObject({ kind: "input" });
    await moveTask(deps, "L1", "a", { destinationList: "L2" });
    expect(writes).toEqual([{ op: "move", listId: "L1", extra: { destinationList: "L2" } }]);
  });

  const CASES: Readonly<Record<string, (deps: Deps) => Promise<unknown>>> = {
    complete_task: (deps) => completeTask(deps, "L1", "a", true),
    update_task: (deps) => updateTask(deps, "L1", "a", { title: "Call Ana back", due: "2026-10-26" }),
  };

  it("has a case for every Tasks write the policy declares idempotent", () => {
    expect(Object.keys(CASES).sort()).toEqual(idempotentWrites(TASKS));
  });

  for (const [name, run] of Object.entries(CASES)) {
    it(`${name} twice makes one change`, async () => {
      const { deps, writes } = fake("personal", [home], { L1: [{ id: "a", title: "Call Ana", status: "needsAction" }] });
      await run(deps);
      const second = await run(deps);
      expect(writes).toHaveLength(1);
      expect(second).toMatchObject({ unchanged: true });
    });
  }

  it("reopens a completed task and clears its completion time", async () => {
    const { deps, writes } = fake("personal", [home], { L1: [{ id: "a", title: "Done", status: "completed", completed: "2026-10-20T10:00:00.000Z" }] });
    await completeTask(deps, "L1", "a", false);
    expect(writes[0]?.body).toEqual({ status: "needsAction", completed: null });
  });
});

describe("the Tasks adapter", () => {
  const recording = (answer: unknown = {}) => {
    const calls: { url: string; spec: RequestSpec }[] = [];
    const request = (async (url: string, spec: RequestSpec = {}) => (calls.push({ url, spec }), answer)) as unknown as Request;
    return { calls, api: makeTasksApi(request) };
  };

  it("asks for hidden and assigned tasks with the completed ones, and encodes every id", async () => {
    const { calls, api } = recording({ items: [] });
    await api.tasks("L/1", { includeCompleted: true, limit: 50, dueMin: "2026-10-22T00:00:00.000Z" });
    expect(calls[0]?.url).toBe("https://tasks.googleapis.com/tasks/v1/lists/L%2F1/tasks");
    expect(calls[0]?.spec.query).toMatchObject({ showCompleted: "true", showHidden: "true", showAssigned: "true", dueMin: "2026-10-22T00:00:00.000Z", maxResults: 100 });
  });

  it("never retries a create or a move, and moves between lists by destinationTasklist", async () => {
    const { calls, api } = recording({ id: "t" });
    await api.insert("L1", { title: "x" }, { previous: "s" });
    await api.move("L1", "t", { destinationList: "L2" });
    expect(calls.map((c) => [c.spec.method, c.spec.idempotent, c.spec.query])).toEqual([
      ["POST", false, { previous: "s" }],
      ["POST", false, { destinationTasklist: "L2" }],
    ]);
    expect(calls[1]?.url).toBe("https://tasks.googleapis.com/tasks/v1/lists/L1/tasks/t/move");
  });
});
