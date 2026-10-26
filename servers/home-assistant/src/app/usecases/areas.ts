import { closest } from "../../domain/closest.js";
import { areasView } from "../../domain/areas.js";
import { areaNamed } from "../../domain/entities.js";
import { fail } from "../../domain/errors.js";
import type { Deps } from "../ports.js";

export type AreasArgs = { readonly area?: string | undefined; readonly entities: boolean };

/** Every area (or one) with its floor, devices and entities, from the registries. */
export const listAreas = async (deps: Deps, a: AreasArgs) => {
  const registries = await deps.ha.registries();
  const area =
    a.area === undefined
      ? undefined
      : (areaNamed(registries.areas, a.area) ??
        fail({
          kind: "not_found",
          what: "area",
          name: a.area,
          message: `Home Assistant has no area "${a.area}"`,
          suggestions: closest(a.area, registries.areas.flatMap((x) => [x.name, x.id])),
        }));
  return areasView(registries, { area, entities: a.entities });
};
