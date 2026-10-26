import type { Collection, Login, Organization } from "./schema.js";

/**
 * Moving an item between collections, as pure rules. A move replaces the
 * item's collections with the one named, and stays inside the item's own
 * organization: Bitwarden encrypts an organization's items with that
 * organization's key, so taking an item out of the account's own vault, or
 * from one organization to another, changes who owns it. That is a person's
 * step in the web vault, not this server's.
 */

/** Already in exactly that collection and no other: a move would change nothing. */
export const alreadyIn = (item: Login, target: Collection): boolean => item.collectionIds.length === 1 && item.collectionIds[0] === target.id;

/** Whether the collection is outside the item's organization (an item in the account's own vault is outside every one). */
export const crossesOrganizations = (item: Login, target: Collection): boolean => item.organizationId !== target.organizationId;

const nameOf = (id: string, organizations: readonly Organization[]): string => organizations.find((o) => o.id === id)?.name ?? id;

/** Why a move that crosses organizations is refused, and what to do instead. */
export const crossingRefusal = (
  item: Login,
  target: Collection,
  organizations: readonly Organization[],
  collections: readonly Collection[],
): string => {
  const targetOrg = nameOf(target.organizationId, organizations);
  if (item.organizationId === null) {
    return (
      `${item.name} is in the account's own vault, outside any organization, and move_item moves an item only between ` +
      `the collections of its own organization: to share it, move it into ${targetOrg} in the web vault, choosing ${target.name} there`
    );
  }
  const own = collections.filter((c) => c.organizationId === item.organizationId).map((c) => c.name);
  const instead = own.length === 0 ? "" : `pick one of its own organization's collections (${own.join(", ")}), or `;
  return (
    `${item.name} belongs to the organization ${nameOf(item.organizationId, organizations)}, and ${target.name} to ${targetOrg}; ` +
    `Bitwarden does not move an item between organizations: ${instead}have a person copy it into ${targetOrg} in the web vault`
  );
};
