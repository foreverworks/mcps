/** Every tool that reads across accounts takes this to mean "every account at once". */
export const ALL_ACCOUNTS = "*";

/**
 * What an account label may be, in every product: lowercase letters, digits
 * and hyphens. A label names a directory in several registries, so it can
 * never hold a dot or a slash and walk out of its root.
 */
export const LABEL = /^[a-z0-9][a-z0-9-]*$/;
