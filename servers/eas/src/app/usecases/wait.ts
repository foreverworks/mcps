import { pause, reportProgress } from "@foreverworks/mcp-kit";

import { fail, inputError } from "../../domain/errors.js";
import type { Deps } from "../ports.js";
import { buildAnswer } from "./builds.js";
import { runAnswer } from "./workflows.js";

/** A run is over in one of these; ACTION_REQUIRED waits for a person, so a wait stops there too. */
const RUN_OVER = new Set(["SUCCESS", "FAILURE", "CANCELED"]);
const BUILD_OVER = new Set(["FINISHED", "ERRORED", "CANCELED"]);
const JOB_OVER = new Set(["SUCCESS", "FAILURE", "CANCELED", "SKIPPED"]);

/** How often a run or a build is looked at. A build takes minutes, so a look every 15 s is plenty and costs EAS little. */
export const POLL_MS = 15_000;

export type WaitInput = { readonly run?: string | undefined; readonly build?: string | undefined; readonly minutes: number; readonly lines: number };

/**
 * Waits for a workflow run or a build to end, looking every POLL_MS, and
 * answers what get_workflow_run or get_build would then (with the reason a
 * failure failed); a client that asked hears the seconds waited and where the
 * run stands meanwhile, and one that cancels ends the wait at once. A run that
 * needs a person (ACTION_REQUIRED), or a wait past `minutes`, answers
 * done: false with the state it is in.
 */
export const waitForRun = async (deps: Deps, input: WaitInput) => {
  if ((input.run === undefined) === (input.build === undefined)) return fail(inputError("give one of run (a workflow run id) or build (a build id)"));
  const started = deps.now();
  const limit = input.minutes * 60;
  const waited = () => Math.round((deps.now() - started) / 1000);
  for (;;) {
    if (input.run !== undefined) {
      const run = await deps.eas.run(input.run);
      if (RUN_OVER.has(run.status)) return { done: true as const, waited_s: waited(), ...(await runAnswer(deps, run, input.lines)) };
      const jobs = `${run.jobs.filter((j) => JOB_OVER.has(j.status)).length} of ${run.jobs.length} jobs done`;
      const running = run.jobs.filter((j) => j.status === "IN_PROGRESS").map((j) => j.key);
      if (run.status === "ACTION_REQUIRED") {
        return { done: false as const, waited_s: waited(), status: run.status, jobs, next: "the run waits for someone to approve a job on expo.dev; wait again once they have" };
      }
      reportProgress(waited(), limit, `${run.workflow.fileName} ${run.status}, ${jobs}${running.length === 0 ? "" : `, running ${running.join(", ")}`}`);
      if (waited() >= limit) return { done: false as const, waited_s: waited(), status: run.status, jobs, next: "call wait_for_run again to keep waiting" };
    } else {
      const build = await deps.eas.build(input.build as string);
      if (BUILD_OVER.has(build.status)) return { done: true as const, waited_s: waited(), ...(await buildAnswer(deps, build, { steps: false, lines: input.lines })) };
      reportProgress(waited(), limit, `${build.platform} ${build.buildProfile ?? "build"} ${build.status}`);
      if (waited() >= limit) return { done: false as const, waited_s: waited(), status: build.status, next: "call wait_for_run again to keep waiting" };
    }
    await pause(Math.min(POLL_MS, Math.max(1_000, limit * 1000 - (deps.now() - started))), deps.sleep, "EAS was not asked again; the run goes on, and wait_for_run picks it up");
  }
};
