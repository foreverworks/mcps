import type { Request } from "../../infra/httpJson.js";
import type { Placement, TaskQuery, TasksPort } from "../app/ports.js";
import type { Page, RawTask, RawTaskList } from "../domain/schema.js";

/** The only file that knows Google Tasks' URLs and parameter names. */
const BASE = "https://tasks.googleapis.com/tasks/v1";
const enc = encodeURIComponent;
const listUrl = (listId: string) => `${BASE}/lists/${enc(listId)}/tasks`;
const taskUrl = (listId: string, taskId: string) => `${listUrl(listId)}/${enc(taskId)}`;

/** tasks.list's page cap ("max allowed: 100"); task lists take the same. */
const PAGE = 100;

const placementQuery = (p: Placement) => ({ ...(p.parent ? { parent: p.parent } : {}), ...(p.previous ? { previous: p.previous } : {}) });

export const makeTasksApi = (request: Request): TasksPort => ({
  lists: async () => {
    const all: RawTaskList[] = [];
    let pageToken: string | undefined;
    do {
      const page = await request<Page<RawTaskList>>(`${BASE}/users/@me/lists`, { query: { maxResults: PAGE, pageToken } });
      all.push(...(page.items ?? []));
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken);
    return all;
  },

  defaultList: () => request<RawTaskList>(`${BASE}/users/@me/lists/@default`),

  tasks: async (listId: string, q: TaskQuery) => {
    const items: RawTask[] = [];
    let pageToken: string | undefined;
    do {
      const page = await request<Page<RawTask>>(listUrl(listId), {
        query: {
          maxResults: PAGE,
          pageToken,
          showCompleted: String(q.includeCompleted),
          // A task completed in Google's own apps is hidden: only showHidden returns it.
          showHidden: String(q.includeCompleted),
          // Tasks assigned to the user from a Doc or a Chat space are theirs too.
          showAssigned: "true",
          dueMin: q.dueMin,
          dueMax: q.dueMax,
        },
      });
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken ?? undefined;
    } while (pageToken && items.length < q.limit);
    return { items: items.slice(0, q.limit), more: items.length > q.limit || pageToken !== undefined };
  },

  get: (listId, taskId) => request<RawTask>(taskUrl(listId, taskId)),

  insert: (listId, body, placement) =>
    request<RawTask>(listUrl(listId), { method: "POST", json: body, query: placementQuery(placement), idempotent: false }),

  patch: (listId, taskId, body) => request<RawTask>(taskUrl(listId, taskId), { method: "PATCH", json: body }),

  move: (listId, taskId, placement) =>
    request<RawTask>(`${taskUrl(listId, taskId)}/move`, {
      method: "POST",
      query: { ...placementQuery(placement), ...(placement.destinationList ? { destinationTasklist: placement.destinationList } : {}) },
      idempotent: false,
    }),

  insertList: (title) => request<RawTaskList>(`${BASE}/users/@me/lists`, { method: "POST", json: { title }, idempotent: false }),

  probe: () => request<Page<RawTaskList>>(`${BASE}/users/@me/lists`, { query: { maxResults: 1 } }),
});
