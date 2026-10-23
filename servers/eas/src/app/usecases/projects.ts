import { configError, fail, notFound } from "../../domain/errors.js";
import { chooseProject, isUuid } from "../../domain/projects.js";
import type { RawApp } from "../../domain/schema.js";
import type { Deps, EasPort, Visible } from "../ports.js";

/** Every project of every account the token belongs to. */
export const loadVisible = async (eas: EasPort): Promise<Visible> => {
  const me = await eas.me();
  const perAccount = await Promise.all(me.accounts.map(async (a) => (await eas.accountApps(a.name)).map((app) => ({ ...app, account: a.name }))));
  return { me, apps: perAccount.flat() };
};

/**
 * The project a call means: the one it names (id, full name, or a slug only
 * one visible project has), else the deployment's default, else the only
 * project the token sees. An id is asked for directly, so a project the
 * listing missed still resolves.
 */
export const resolveProject = async (deps: Deps, name: string | undefined): Promise<RawApp> => {
  const wanted = name ?? deps.defaultProject;
  if (wanted !== undefined && isUuid(wanted.trim())) return deps.eas.app(wanted.trim());
  const { apps } = await deps.visible();
  const choice = chooseProject(wanted, apps);
  if ("app" in choice) return choice.app;
  return apps.length === 0 ? fail(configError(choice.problem)) : fail(notFound(choice.problem));
};

export const listProjects = async (deps: Deps) => {
  const { me, apps } = await deps.visible();
  return {
    actor: { kind: me.__typename, name: me.displayName },
    accounts: me.accounts.map((a) => ({
      name: a.name,
      projects: apps.filter((p) => p.account === a.name).map((p) => ({ id: p.id, fullName: p.fullName, name: p.name })),
    })),
    ...(deps.defaultProject === undefined ? {} : { defaultProject: deps.defaultProject }),
  };
};

/**
 * Is the token there and accepted, whose is it, and does it see a project:
 * reads only, nothing spent. A robot that sees no project is useless and says so.
 */
export const checkHealth = async (deps: Deps) => {
  const { me, apps } = await deps.visible();
  const problems = apps.length === 0 ? ["the token sees no project: add its robot to the project's account at expo.dev"] : [];
  return {
    ok: problems.length === 0,
    actor: { kind: me.__typename, name: me.displayName },
    accounts: me.accounts.map((a) => a.name),
    projects: apps.map((p) => p.fullName),
    ...(problems.length === 0 ? {} : { problems }),
  };
};
