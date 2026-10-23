/**
 * The People API's wire shapes, written from its Discovery document (people
 * v1, revision 20261020): the fields a search reads, every one optional.
 */
export type RawPerson = {
  readonly resourceName?: string | null;
  readonly names?: readonly { readonly displayName?: string | null }[] | null;
  readonly emailAddresses?: readonly { readonly value?: string | null; readonly type?: string | null }[] | null;
  readonly phoneNumbers?: readonly { readonly value?: string | null; readonly canonicalForm?: string | null }[] | null;
  readonly organizations?: readonly { readonly name?: string | null; readonly title?: string | null; readonly department?: string | null }[] | null;
};

/** people.searchContacts and otherContacts.search. */
export type RawSearchResponse = { readonly results?: readonly { readonly person?: RawPerson | null }[] | null };

/** people.searchDirectoryPeople. */
export type RawDirectoryResponse = { readonly people?: readonly RawPerson[] | null; readonly nextPageToken?: string | null };
