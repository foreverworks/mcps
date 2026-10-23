import { describeThrown, inputError, fail } from "../../domain/errors.js";
import { findLabel, type NamedLabel } from "../../domain/labels.js";
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from "../../infra/pool.js";
import type { Deps, LabelSpec } from "../ports.js";
import { knownLabels, labelChange } from "./labelChange.js";
import { requireWrite } from "./writeGuard.js";

export type Target = "message" | "thread";

const idsOf = (ids: readonly string[]): readonly string[] => {
  const clean = [...new Set(ids.map((i) => i.trim()).filter(Boolean))];
  return clean.length ? clean : fail(inputError("no ids given"));
};

type Outcome = { readonly done: readonly string[]; readonly failed?: readonly { readonly id: string; readonly error: string }[] };

/**
 * One request per id, each one's outcome kept: a call over twenty ids where
 * one fails must say which nineteen changed, not throw away that they did.
 * When every id fails, the first failure is the call's, with its remedy.
 */
const eachId = async (ids: readonly string[], act: (id: string) => Promise<unknown>): Promise<Outcome> => {
  const outcomes = await mapWithConcurrency(ids, DEFAULT_CONCURRENCY, async (id) => {
    try {
      await act(id);
      return { id };
    } catch (thrown) {
      return { id, thrown };
    }
  });
  const done = outcomes.flatMap((o) => ("thrown" in o ? [] : [o.id]));
  const failed = outcomes.flatMap((o) => ("thrown" in o ? [{ id: o.id, error: describeThrown(o.thrown) }] : []));
  if (done.length === 0 && outcomes[0] !== undefined && "thrown" in outcomes[0]) throw outcomes[0].thrown;
  return { done, ...(failed.length > 0 ? { failed } : {}) };
};

/**
 * Add and remove labels on messages or whole threads. Archive, read/unread,
 * star and importance are all this one call, because in Gmail they ARE labels:
 * archive removes INBOX, read removes UNREAD, a star adds STARRED.
 */
export const modifyLabels = async (
  deps: Deps,
  input: { readonly target: Target; readonly ids: readonly string[]; readonly add: readonly string[]; readonly remove: readonly string[] },
) => {
  await requireWrite(deps);
  const ids = idsOf(input.ids);
  const change = await labelChange(deps, input.add, input.remove);
  if (change.add.length + change.remove.length === 0) return fail(inputError("nothing to add or remove"));

  // Messages go in one batchModify, which applies to all of them or fails whole; threads one request
  // each (at most 16 in flight), each with its own outcome.
  const outcome: Outcome = input.target === "message" ? (await deps.write.modifyMessages(ids, change), { done: ids }) : await eachId(ids, (id) => deps.write.modifyThread(id, change));
  return { account: deps.account, target: input.target, ids: outcome.done, ...(outcome.failed ? { failed: outcome.failed } : {}), added: change.add, removed: change.remove };
};

/** Trash is recoverable for 30 days; this server has no permanent delete, by scope as well as by choice. */
export const trash = async (deps: Deps, input: { readonly target: Target; readonly ids: readonly string[] }) => {
  await requireWrite(deps);
  const outcome = await eachId(idsOf(input.ids), (id) => deps.write.trash(input.target, id));
  return { account: deps.account, target: input.target, trashed: outcome.done, ...(outcome.failed ? { failed: outcome.failed } : {}) };
};

export const untrash = async (deps: Deps, input: { readonly target: Target; readonly ids: readonly string[] }) => {
  await requireWrite(deps);
  const outcome = await eachId(idsOf(input.ids), (id) => deps.write.untrash(input.target, id));
  return { account: deps.account, target: input.target, untrashed: outcome.done, ...(outcome.failed ? { failed: outcome.failed } : {}) };
};

/** What Gmail's own Report spam does: into SPAM, out of the inbox. */
export const markSpam = (deps: Deps, input: { readonly target: Target; readonly ids: readonly string[] }) =>
  modifyLabels(deps, { ...input, add: ["SPAM"], remove: ["INBOX"] });

export const unmarkSpam = (deps: Deps, input: { readonly target: Target; readonly ids: readonly string[] }) =>
  modifyLabels(deps, { ...input, add: ["INBOX"], remove: ["SPAM"] });

export type LabelInput = {
  readonly name?: string;
  readonly labelListVisibility?: string;
  readonly messageListVisibility?: string;
  readonly backgroundColor?: string;
  readonly textColor?: string;
};

const specOf = (input: LabelInput): LabelSpec => {
  if ((input.backgroundColor === undefined) !== (input.textColor === undefined)) {
    return fail(inputError("a label colour needs both background_color and text_color"));
  }
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.labelListVisibility ? { labelListVisibility: input.labelListVisibility } : {}),
    ...(input.messageListVisibility ? { messageListVisibility: input.messageListVisibility } : {}),
    ...(input.backgroundColor && input.textColor
      ? { color: { backgroundColor: input.backgroundColor, textColor: input.textColor } }
      : {}),
  };
};

export const createLabel = async (deps: Deps, input: LabelInput) => {
  await requireWrite(deps);
  if (!input.name?.trim()) return fail(inputError("a label needs a name"));
  return { account: deps.account, label: await deps.write.createLabel(specOf(input)) };
};

/** A user label, by id or by name. System labels (INBOX, SENT, ...) cannot be changed and are refused here. */
const userLabel = async (deps: Deps, wanted: string): Promise<NamedLabel> => {
  const label = findLabel(wanted, await knownLabels(deps));
  if (!label) return fail(inputError(`no label "${wanted}"; list_labels shows what exists`));
  if (label.type === "system") return fail(inputError(`"${label.name}" is a system label and cannot be changed`));
  return label;
};

export const updateLabel = async (deps: Deps, wanted: string, input: LabelInput) => {
  await requireWrite(deps);
  const label = await userLabel(deps, wanted);
  return { account: deps.account, label: await deps.write.updateLabel(label.id, specOf(input)) };
};

/** Removes the label from every message that carries it; the messages themselves stay. */
export const deleteLabel = async (deps: Deps, wanted: string) => {
  await requireWrite(deps);
  const label = await userLabel(deps, wanted);
  await deps.write.deleteLabel(label.id);
  return { account: deps.account, deleted: true, labelId: label.id, name: label.name };
};
