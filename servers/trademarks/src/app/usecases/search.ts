import { UNCOVERED } from "../../domain/coverage.js";
import { asAppError, remedyFor } from "../../domain/errors.js";
import { OFFICES, type Mark, type Office } from "../../domain/mark.js";
import { admits, countByRelation, inClasses, ranked, relationOf, type Hit } from "../../domain/match.js";
import type { SearchQuery } from "../../domain/query.js";
import { similarityOf } from "../../domain/similarity.js";
import type { Deps, RegisterPort } from "../ports.js";

/** A mark as a listing shows it: the office is the section's, so it is not repeated per row. */
const listed = ({ office: _office, ...hit }: Hit) => hit;

const searchOne = async (register: RegisterPort, query: SearchQuery) => {
  const page = await register.search({ name: query.name, classes: query.classes, match: query.match, status: query.status, goods: query.goods });
  // The source filtered already; these hold it to the same rule whatever the source's query could say
  // (a USPTO class filter also matches a class the office has since cancelled from the mark).
  const kept = page.marks.filter((m: Mark) => inClasses(m.classes, query.classes) && (query.status === "all" || m.status !== "dead"));
  const hits = ranked(
    kept
      .map((m): Hit => {
        const similarity = similarityOf(query.name, m.mark);
        return { ...m, relation: relationOf(query.name, m.mark), ...(similarity === undefined ? {} : { similarity }) };
      })
      .filter((h) => admits(query.match, h.relation)),
  );
  return {
    office: register.office,
    source: register.source,
    searched: true as const,
    found: page.found,
    examined: page.marks.length,
    ...(page.found > page.marks.length ? { more: true as const } : {}),
    // Said wherever goods were asked for: an office whose source cannot filter on them lists its marks unfiltered.
    ...(query.goods === undefined ? {} : { goods_filter: register.goods ? ("applied" as const) : ("unsupported" as const) }),
    counts: countByRelation(hits),
    marks: hits.slice(0, query.limit).map(listed),
  };
};

/**
 * One name across offices, each register asked once and at the same time. An
 * office that cannot be searched, or whose source failed, says so in its own
 * section: an empty section always means searched and nothing found.
 */
export const searchMarks = async (deps: Deps, query: SearchQuery) => {
  const offices: readonly Office[] = query.offices.length > 0 ? [...new Set(query.offices)] : OFFICES;
  const sections = await Promise.all(
    offices.map(async (office) => {
      const register = deps.registers.find((r) => r.office === office);
      if (register === undefined) return { office, searched: false as const, reason: UNCOVERED[office] ?? `not searched: no source for ${office} is enabled on this server` };
      try {
        return await searchOne(register, query);
      } catch (thrown) {
        const error = asAppError(thrown);
        if (error === undefined) throw thrown;
        return { office, source: register.source, searched: false as const, error: { kind: error.kind, message: error.message, remedy: remedyFor(error) } };
      }
    }),
  );
  return {
    name: query.name,
    match: query.match,
    status: query.status,
    ...(query.classes.length > 0 ? { classes: query.classes } : {}),
    ...(query.goods === undefined ? {} : { goods: query.goods }),
    offices: sections,
  };
};
