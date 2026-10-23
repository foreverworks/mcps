import { asAppError } from "../../domain/errors.js";
import type { Deps } from "../ports.js";

/** A store's failure as health reports it: one without credentials is not configured, not broken. */
const failed = (thrown: unknown) => {
  const error = asAppError(thrown);
  if (error?.kind === "config") return { configured: false as const, message: error.message };
  return { configured: true as const, ok: false as const, error: error?.kind ?? "unexpected", message: error?.message ?? String(thrown) };
};

/**
 * Whether each store's credentials work, with what they reach: the apps the
 * App Store Connect key sees, and for each Play package one review read. A
 * store without credentials is reported as not configured, not as a fault.
 */
export const health = async (deps: Deps) => {
  const appStore = await deps.appStore.apps().then(
    (apps) => ({ configured: true as const, ok: true as const, apps: apps.map((a) => ({ id: a.id, bundleId: a.bundleId, name: a.name })) }),
    failed,
  );
  const play = await deps.play.check().then(async ({ account }) => {
    const packages = await Promise.all(
      deps.packages.map((name) =>
        deps.play.reviews(name, { limit: 1 }).then(
          () => ({ package: name, ok: true as const }),
          (thrown: unknown) => {
            const error = asAppError(thrown);
            return { package: name, ok: false as const, error: error?.kind ?? "unexpected", message: error?.message ?? String(thrown) };
          },
        ),
      ),
    );
    return { configured: true as const, ok: packages.every((p) => p.ok), account, packages };
  }, failed);
  const broken = [appStore, play].some((s) => s.configured && !s.ok);
  return { ok: !broken, appStore, play };
};
