import type { Platform, RawApp } from "./schema.js";

/**
 * How a caller names a project: its id, its full name (`@acme/my-app`),
 * or its slug alone when only one visible project has it. Left out, it is the
 * only project the token can see, or the deployment's default (EAS_PROJECT).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: string): boolean => UUID.test(value);

export type ProjectChoice = { readonly app: RawApp } | { readonly problem: string };

/** The one project a name means among the visible ones, or why there is not exactly one. */
export const chooseProject = (name: string | undefined, visible: readonly RawApp[]): ProjectChoice => {
  if (name === undefined) {
    const [only, ...more] = visible;
    if (only === undefined) return { problem: "this token sees no project" };
    if (more.length > 0) return { problem: `name a project: this token sees ${visible.map((a) => a.fullName).join(", ")}` };
    return { app: only };
  }
  const wanted = name.trim();
  const hit =
    visible.find((a) => a.id === wanted || a.fullName === wanted) ??
    visible.find((a) => a.fullName === `@${wanted}`) ??
    (() => {
      const bySlug = visible.filter((a) => a.slug === wanted);
      return bySlug.length === 1 ? bySlug[0] : undefined;
    })();
  return hit === undefined ? { problem: `no visible project is "${wanted}"; this token sees ${visible.map((a) => a.fullName).join(", ") || "none"}` } : { app: hit };
};

/** The tools say ios/android, EAS says IOS/ANDROID. */
export const toPlatform = (platform: "ios" | "android"): Platform => (platform === "ios" ? "IOS" : "ANDROID");
