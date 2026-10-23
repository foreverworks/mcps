/**
 * The words a model reads (the server's instructions, and the parts of tool descriptions that depend
 * on the deployment), derived from the catalog: its wrappers, where a session finds its id, its
 * profiles. Nothing here names a host, a command or a profile the catalog does not.
 */
import { allWrappers, profilesOf, type Catalog } from "../domain/catalog.js";
import { listed } from "../domain/view.js";

/** The deployment's wrappers, each once, as words ("a, b and c"), or "". */
export const wrappersOf = (catalog: Catalog): string => listed(allWrappers(catalog.clients));

/** A verb agreeing with the wrappers: `do` for several, `does` for one. */
export const agree = (catalog: Catalog, plural: string, singular: string): string => (allWrappers(catalog.clients).length === 1 ? singular : plural);

export const instructionsFor = (catalog: Catalog): string => {
  const wrappers = wrappersOf(catalog);
  return [
    "A device broker: the one way to get a phone (an iOS simulator or an Android emulator on the hosts in its catalog) or a mobile build slot.",
    "acquire gives you a lease (or a queue ticket, or the reason nothing can serve you); an emulator the broker starts boots for your lease and stops after it.",
    "You see and lease only your tenant's devices, decided by your token, never by an argument.",
    wrappers === "" ? "" : `${wrappers} ${agree(catalog, "use", "uses")} your lease and ${agree(catalog, "acquire", "acquires")} one for you when you hold none.`,
    "When a person has to take the device over (a sign-in, a code), pause the lease and resume it after, so it is not lost meanwhile.",
    "Release when you are done, and never drive a device you do not hold.",
  ]
    .filter((line) => line !== "")
    .join(" ");
};

/** What the `session` argument is on this deployment, and who else finds a lease by it. */
export const sessionFor = (catalog: Catalog): string => {
  const where = catalog.clients.sessionHint ?? "any id naming your agent session that stays the same on every call (Claude Code's $CLAUDE_CODE_SESSION_ID is one)";
  const wrappers = wrappersOf(catalog);
  return `Your session id: ${where}. A lease is your tenant's and this session's${wrappers === "" ? "" : `; ${wrappers} ${agree(catalog, "find", "finds")} your lease by it, so use the same one`}.`;
};

/** The sentence acquire ends with when the deployment has wrappers that take a lease themselves. */
export const wrappersAcquire = (catalog: Catalog): string => {
  const wrappers = wrappersOf(catalog);
  return wrappers === "" ? "" : ` ${wrappers} ${agree(catalog, "acquire", "acquires")} for you when you hold nothing (and ${agree(catalog, "renew", "renews")} on every use), so calling this first is only needed to wait in line or pick a profile.`;
};

/**
 * The profiles the catalog declares, for the `profile` argument, and what no profile means: a platform's
 * default where the catalog names one (its other profiles only by name), and where a slot serves several.
 */
export const profilesFor = (catalog: Catalog): string => {
  const names = Object.keys(catalog.profiles).sort();
  const several = catalog.devices.some((d) => profilesOf(d).length > 1);
  const defaults = Object.entries(catalog.defaultProfiles).map(([platform, profile]) => `${profile} for ${platform} (its other profiles only when named)`);
  const any = `any device of the platform${several ? ", on its own profile (an emulator slot that serves several starts the one you ask for)" : ""}`;
  return `A profile from status${names.length === 0 ? "" : ` (${names.join(", ")})`}; default: ${defaults.length === 0 ? any : `${listed(defaults)}, else ${any}`}.`;
};
