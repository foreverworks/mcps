/** What the Contacts use cases need, named as operations. No URL appears above infra/. */
import type { Grant } from "../../grants/grant.js";
import type { Source } from "../domain/grants.js";
import type { RawPerson } from "../domain/schema.js";

export type PeoplePort = {
  /** People in one source whose names, addresses, phone numbers or organisations start with the query, most relevant first. */
  readonly search: (source: Source, query: string, limit: number) => Promise<readonly RawPerson[]>;
  /** One cheap read that proves the API answers. */
  readonly probe: () => Promise<unknown>;
};

export type Deps = {
  readonly grant: Grant;
  readonly people: PeoplePort;
};
