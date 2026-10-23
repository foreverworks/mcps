import { fail, inputError, notFound } from "../../domain/errors.js";
import type { AscApp, Deps } from "../ports.js";

/** A Play package name: dot-separated Java identifiers, as Play Console shows it. */
const PACKAGE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/;

/**
 * The App Store Connect app a call means: by its Apple id (digits) or its
 * bundle id, or the only app the key sees when the call names none.
 */
export const resolveAscApp = async (deps: Deps, app: string | undefined): Promise<AscApp> => {
  const wanted = app?.trim();
  const apps = await deps.appStore.apps();
  const names = apps.map((a) => `${a.bundleId} (${a.id})`).join(", ") || "none";
  if (wanted === undefined || wanted === "") {
    const [only, ...more] = apps;
    if (only !== undefined && more.length === 0) return only;
    return fail(inputError(`name the app: the key sees ${names}`));
  }
  return apps.find((a) => a.id === wanted || a.bundleId === wanted) ?? fail(notFound(`the App Store Connect key sees no app ${wanted}; it sees ${names}`));
};

/** The Play package a call means: the one named, or the only one this deployment answers for. */
export const resolvePackage = (deps: Deps, packageName: string | undefined): string => {
  const wanted = packageName?.trim();
  if (wanted === undefined || wanted === "") {
    const [only, ...more] = deps.packages;
    if (only !== undefined && more.length === 0) return only;
    return fail(inputError(deps.packages.length === 0 ? "name the package, e.g. com.example.app (PLAY_PACKAGES names none)" : `name the package: one of ${deps.packages.join(", ")}`));
  }
  return PACKAGE.test(wanted) ? wanted : fail(inputError(`"${wanted}" is not a Play package name (e.g. com.example.app)`));
};
