import { summaryFrom, type ToolPolicy } from "@foreverworks/mcp-kit";
import { z } from "zod";

import type { Deps } from "../app/ports.js";
import { planDispatch } from "../app/usecases/workflows.js";
import { DISPATCH } from "./controllers/workflows.js";

/**
 * Every tool, classified (packages/mcp-kit, policy.ts).
 *
 * - read: the listings, the logs, the audit, health. They change nothing.
 *   validate_workflow among them: EAS's validator stores nothing, and a file
 *   read at a ref is kept by EAS as a revision, which runs nothing.
 * - write: cancelling a build or a run, setting the submit key, submitting an
 *   existing build (no build credits; it reaches TestFlight or a Play track),
 *   republishing an update group, onto a production channel too (it spends
 *   nothing, and a republish can be undone by another); raising or reverting
 *   an update's rollout, likewise. set_rollout sets a state, so it is
 *   idempotent: the same percentage again changes nothing.
 * - money: anything that spends EAS build credits. That is a dispatch: the
 *   workflow's build jobs run on EAS's builders. Its `resolve` reads the
 *   workflow file at the ref before the call runs, so the summary line names
 *   each build job's platform and profile, and the run that follows starts
 *   that revision (the file's content), not whatever the ref holds by then.
 *   Starting a build from a local tree is not offered at all: it uploads the
 *   working directory, which is slow, and nobody could see what is built.
 *
 * A function of the dependencies, because `resolve` asks EAS.
 */
const dispatchArgs = z.object(DISPATCH);
const planned = z.object({ plan: z.object({ line: z.string().min(1) }) });

export const policyFor = (deps: Deps): ToolPolicy => ({
  health: { access: "read" },
  list_projects: { access: "read" },
  list_builds: { access: "read" },
  get_build: { access: "read" },
  list_workflows: { access: "read" },
  list_workflow_runs: { access: "read" },
  validate_workflow: { access: "read" },
  get_workflow_run: { access: "read" },
  wait_for_run: { access: "read" },
  get_job_logs: { access: "read" },
  list_submissions: { access: "read" },
  get_submission: { access: "read" },
  audit_credentials: { access: "read" },
  list_fingerprints: { access: "read" },
  list_updates: { access: "read" },
  cancel_build: { access: "write" },
  cancel_workflow_run: { access: "write" },
  set_submit_key: { access: "write" },
  submit_build: { access: "write" },
  republish_update: { access: "write" },
  set_rollout: { access: "write", idempotent: true },
  revert_rollout: { access: "write" },
  dispatch_workflow: {
    access: "money",
    resolve: async (args) => {
      const parsed = dispatchArgs.parse(args);
      return { ...args, plan: await planDispatch(deps, { workflow: parsed.workflow, git_ref: parsed.git_ref, ...(parsed.project === undefined ? {} : { project: parsed.project }) }) };
    },
    summary: summaryFrom(planned, (a) => a.plan.line),
  },
});
