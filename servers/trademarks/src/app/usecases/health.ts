import { UNCOVERED } from "../../domain/coverage.js";
import { asAppError, remedyFor } from "../../domain/errors.js";
import type { Office } from "../../domain/mark.js";
import type { Deps, RecordsPort, RegisterPort } from "../ports.js";

const aboutRegister = (r: RegisterPort) => ({ office: r.office, source: r.source, official: r.official, similar: r.similarity, goods_filter: r.goods });
const aboutRecords = (r: RecordsPort) => ({ office: r.office, source: r.source, official: true });

const probed = async <A extends object>(deps: Deps, probe: () => Promise<void>, about: A) => {
  const started = deps.now();
  try {
    await probe();
    return { ...about, state: "ok" as const, ms: deps.now() - started };
  } catch (thrown) {
    const error = asAppError(thrown);
    if (error === undefined) throw thrown;
    // Credentials not yet issued are a source waiting to be set up, not a failing service.
    if (error.kind === "config") return { ...about, state: "not_configured" as const, reason: error.message, remedy: remedyFor(error) };
    // Credentials accepted, the product's subscription not approved yet: waiting on the register.
    if (error.kind === "subscription") return { ...about, state: "pending" as const, reason: error.message, remedy: remedyFor(error) };
    return { ...about, state: "failing" as const, error: { kind: error.kind, message: error.message }, remedy: remedyFor(error) };
  }
};

/**
 * Every source asked the cheapest question it answers: the registers that
 * search, and the case-file sources (status histories and documents). `ok`: at
 * least one register searches, and no source that is configured fails.
 */
export const checkHealth = async (deps: Deps) => {
  const [sources, records] = await Promise.all([
    Promise.all(deps.registers.map((r) => probed(deps, r.probe, aboutRegister(r)))),
    Promise.all(deps.records.map((r) => probed(deps, r.probe, aboutRecords(r)))),
  ]);
  const uncovered = (Object.entries(UNCOVERED) as [Office, string][])
    .filter(([office]) => !deps.registers.some((r) => r.office === office))
    .map(([office, reason]) => ({ office, reason }));
  return {
    ok: sources.some((s) => s.state === "ok") && [...sources, ...records].every((s) => s.state !== "failing"),
    sources,
    records,
    uncovered,
  };
};
