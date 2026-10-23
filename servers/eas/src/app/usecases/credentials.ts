import { auditAndroid, auditIos, type Target, targetsOf } from "../../domain/credentials.js";
import { fail, inputError, notFound } from "../../domain/errors.js";
import type { Deps } from "../ports.js";
import { resolveProject } from "./projects.js";

/** Builds read to learn which identifiers a project builds for: enough to cover every profile in use. */
const RECENT_BUILDS = 50;

/**
 * Per bundle id and package of a project: what EAS holds for building and
 * submitting, and what is missing, expired or expiring. Two reads, nothing
 * secret selected (domain/credentials.ts has the rules).
 */
export const auditCredentials = async (
  deps: Deps,
  args: { readonly project?: string; readonly platform?: "ios" | "android"; readonly identifier?: string },
) => {
  const app = await resolveProject(deps, args.project);
  const [credentials, builds] = await Promise.all([deps.eas.credentials(app.id), deps.eas.builds(app.id, { offset: 0, limit: RECENT_BUILDS })]);
  const known: Target[] = [
    ...credentials.ios.map((c) => ({ platform: "ios" as const, identifier: c.appleAppIdentifier.bundleIdentifier })),
    ...credentials.android.flatMap((c) => (c.applicationIdentifier === null ? [] : [{ platform: "android" as const, identifier: c.applicationIdentifier }])),
    ...builds.flatMap((b) => (b.appIdentifier === null ? [] : [{ platform: b.platform === "IOS" ? ("ios" as const) : ("android" as const), identifier: b.appIdentifier }])),
  ];
  const now = deps.now();
  const audited = targetsOf(known, args).map((t) =>
    t.platform === "ios"
      ? auditIos(t.identifier, credentials.ios.find((c) => c.appleAppIdentifier.bundleIdentifier === t.identifier), now)
      : auditAndroid(t.identifier, credentials.android.find((c) => c.applicationIdentifier === t.identifier)),
  );
  return {
    project: app.fullName,
    ok: audited.every((a) => a.ok),
    missing: audited.flatMap((a) => a.missing.map((m) => `${a.platform} ${a.identifier}: ${m}`)),
    identifiers: audited,
  };
};

/**
 * Set (or clear) the App Store Connect API key EAS uses to submit one bundle
 * id, as `eas credentials` does, in one call. The key is named by its Apple
 * key id (`ABCDE12345`) or its EAS id, among the keys the project's account
 * holds: a key is referenced, never uploaded, so no key material passes
 * through a call.
 * Answers with the bundle's audit afterwards, so the change is read back.
 */
export const setSubmitKey = async (
  deps: Deps,
  args: { readonly project?: string; readonly bundle_id: string; readonly key?: string; readonly clear: boolean },
) => {
  if (args.clear === (args.key !== undefined)) return fail(inputError("name a key to set, or pass clear: true to remove the one set; not both"));
  const app = await resolveProject(deps, args.project);
  const credentials = await deps.eas.credentials(app.id);
  const ios = credentials.ios.find((c) => c.appleAppIdentifier.bundleIdentifier === args.bundle_id);
  if (ios === undefined) {
    const known = credentials.ios.map((c) => c.appleAppIdentifier.bundleIdentifier);
    return fail(notFound(`${app.fullName} has no iOS credentials for ${args.bundle_id} (it has ${known.join(", ") || "none"}); create them once with eas credentials`));
  }
  const before = ios.appStoreConnectApiKeyForSubmissions?.keyIdentifier ?? null;
  let keyId: string | null = null;
  if (args.key !== undefined) {
    const wanted = args.key.trim();
    const account = app.fullName.replace(/^@/, "").split("/")[0] ?? "";
    const keys = await deps.eas.ascKeys(account);
    const key = keys.find((k) => k.keyIdentifier === wanted || k.id === wanted);
    if (key === undefined) {
      return fail(notFound(`the ${account} account holds no App Store Connect API key "${wanted}" on EAS (it holds ${keys.map((k) => k.keyIdentifier).join(", ") || "none"})`));
    }
    keyId = key.id;
  }
  const after = await deps.eas.setSubmitKey(ios.id, keyId);
  return { project: app.fullName, bundleId: args.bundle_id, before, audit: auditIos(args.bundle_id, after, deps.now()) };
};
