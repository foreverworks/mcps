import { compact, type FileSource, mapWithConcurrency } from "@foreverworks/mcp-kit";

import { asAppError, fail, inputError, notFound } from "../../domain/errors.js";
import { isFailed, type Step } from "../../domain/logs.js";
import type { RawApp, RawWorkflow, RawWorkflowRunWithJobs, WorkflowBuildJob } from "../../domain/schema.js";
import { jobView, logUrlsOf, runView } from "../../domain/views.js";
import { dispatchLine, isFailedJob, jobFailure, reasonLine } from "../../domain/workflows.js";
import type { Deps } from "../ports.js";
import { readSteps, stepsTable } from "./logs.js";
import { resolveProject } from "./projects.js";

/** Runs whose reasons a listing reads at once: each costs a run query and a log or two. */
const REASON_CONCURRENCY = 4;

export const listWorkflows = async (deps: Deps, args: { readonly project?: string }) => {
  const app = await resolveProject(deps, args.project);
  const workflows = await deps.eas.workflows(app.id);
  return { project: app.fullName, workflows: workflows.map((w) => ({ fileName: w.fileName, name: w.name, updatedAt: w.updatedAt })) };
};

/** A workflow by its file name, with or without the extension (`ios-build` finds `ios-build.yml`). */
const findWorkflow = (workflows: readonly RawWorkflow[], name: string, app: RawApp): RawWorkflow => {
  const wanted = name.trim().replace(/^.*\//, "");
  const hit = workflows.find((w) => w.fileName === wanted) ?? workflows.find((w) => w.fileName.replace(/\.ya?ml$/, "") === wanted.replace(/\.ya?ml$/, ""));
  return hit ?? fail(notFound(`${app.fullName} has no workflow "${wanted}"; it has ${workflows.map((w) => w.fileName).join(", ") || "none"}`));
};

/** Why a failed run failed: the failed jobs' logs are read, at most one request per log file. */
export const explainRun = async (deps: Deps, run: RawWorkflowRunWithJobs, lines = 0) => {
  const failedJobs = run.jobs.filter(isFailedJob);
  const failures = await Promise.all(
    failedJobs.map(async (job) => {
      const steps = await readSteps(deps, logUrlsOf(job)).catch(() => undefined);
      const failure = jobFailure(job, steps);
      const failed = steps?.find(isFailed);
      return { ...failure, ...(lines > 0 && failed !== undefined ? { tail: failed.lines.slice(-lines).map((l) => l.msg) } : {}) };
    }),
  );
  return { reason: reasonLine(run, failures), failures };
};

export type RunsQuery = {
  readonly project?: string;
  readonly workflow?: string;
  readonly status?: string;
  readonly gitRef?: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly reasons: boolean;
};

/**
 * A project's runs, newest first, optionally of one workflow file. Each failed
 * run carries `reason`, one line read from its failed jobs' logs, unless
 * `reasons` is off.
 */
export const listRuns = async (deps: Deps, q: RunsQuery) => {
  const app = await resolveProject(deps, q.project);
  const workflowId = q.workflow === undefined ? undefined : findWorkflow(await deps.eas.workflows(app.id), q.workflow, app).id;
  const page = await deps.eas.runs(app.id, compact({ workflowId, status: q.status, gitRef: q.gitRef, first: q.limit, after: q.cursor }));
  const runs = await mapWithConcurrency(page.items, REASON_CONCURRENCY, async (run) => {
    if (!q.reasons || run.status !== "FAILURE") return runView(run);
    try {
      const { reason } = await explainRun(deps, await deps.eas.run(run.id));
      return { ...runView(run), ...(reason === undefined ? {} : { reason }) };
    } catch {
      return { ...runView(run), reason: "(could not read this run's jobs; get_workflow_run says why)" };
    }
  });
  return { project: app.fullName, runs, ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }) };
};

/** One run with its jobs (status, type, outputs) and, when it failed, why, per failed job and in one line. */
export const getRun = async (deps: Deps, args: { readonly run: string; readonly lines: number }) => runAnswer(deps, await deps.eas.run(args.run), args.lines);

/** What get_workflow_run answers for a run already read. */
export const runAnswer = async (deps: Deps, run: RawWorkflowRunWithJobs, lines: number) => {
  const view = { ...runView(run), jobs: run.jobs.map(jobView) };
  if (!run.jobs.some(isFailedJob) && run.errors.length === 0) return view;
  const { reason, failures } = await explainRun(deps, run, lines);
  return { ...view, ...(reason === undefined ? {} : { reason }), failures };
};

/** A job's log by step: every step's result, and the lines of one (the failed one by default). */
export const jobLogs = async (deps: Deps, args: { readonly job: string; readonly step?: string; readonly lines: number }) => {
  const job = await deps.eas.job(args.job);
  const steps = await readSteps(deps, logUrlsOf(job));
  if (steps === undefined) return { job: job.key, status: job.status, runId: job.workflowRun.id, steps: null, note: "this job has no log (it never started, or was skipped)" };
  const wanted = args.step?.trim().toLowerCase();
  const chosen: Step | undefined =
    wanted === undefined ? (steps.find(isFailed) ?? steps.at(-1)) : steps.find((s) => s.name.toLowerCase() === wanted) ?? steps.find((s) => s.name.toLowerCase().includes(wanted));
  if (wanted !== undefined && chosen === undefined) return fail(inputError(`no step "${args.step}" in this job; its steps are ${steps.map((s) => s.name).join(", ")}`));
  return {
    job: job.key,
    status: job.status,
    runId: job.workflowRun.id,
    steps: stepsTable(steps, 0),
    ...(chosen === undefined ? {} : { step: chosen.name, result: chosen.result ?? "unfinished", lines: chosen.lines.slice(-args.lines).map((l) => l.msg) }),
  };
};

export type DispatchArgs = {
  readonly project?: string;
  readonly workflow: string;
  readonly git_ref: string;
  readonly inputs?: Readonly<Record<string, unknown>>;
};

/** What a dispatch will run: the workflow file at that ref, and the build jobs that spend credits. */
export type DispatchPlan = {
  readonly appId: string;
  readonly project: string;
  readonly fileName: string;
  readonly revisionId: string;
  readonly builds: readonly WorkflowBuildJob[];
  readonly line: string;
};

const REF = /^[A-Za-z0-9._\-/]+$/;

const checkedRef = (gitRef: string): string => {
  const ref = gitRef.trim();
  return !REF.test(ref) || ref.includes("..") ? fail(inputError(`"${gitRef}" is not a git ref: a branch, refs/heads/<branch>, refs/tags/<tag> or a commit hash`)) : ref;
};

/**
 * The workflow file as it is at the ref (EAS reads it from the project's
 * GitHub repository, so nothing local is uploaded), and the one line a user
 * confirms. Runs nothing, spends nothing. The revision is the file's content,
 * so the run that follows runs exactly the jobs the line named.
 */
export const planDispatch = async (deps: Deps, args: DispatchArgs): Promise<DispatchPlan> => {
  const ref = checkedRef(args.git_ref);
  const app = await resolveProject(deps, args.project);
  const workflow = findWorkflow(await deps.eas.workflows(app.id), args.workflow, app);
  const revision = await deps.eas.revisionAt(app.id, workflow.fileName, ref);
  const read = deps.readWorkflow(revision.yaml);
  if ("problem" in read) return fail(inputError(`${revision.fileName} at ${ref}: ${read.problem}; validate_workflow says more`));
  return {
    appId: app.id,
    project: app.fullName,
    fileName: revision.fileName,
    revisionId: revision.revisionId,
    builds: read.builds,
    line: dispatchLine({ project: app.fullName, fileName: revision.fileName, gitRef: ref, builds: read.builds }),
  };
};

/** Start the run the plan describes; the plan comes from the guard (policy.ts `resolve`), or is made here. */
export const dispatch = async (deps: Deps, args: DispatchArgs & { readonly plan?: DispatchPlan }) => {
  const plan = args.plan ?? (await planDispatch(deps, args));
  const run = await deps.eas.dispatch(plan.revisionId, args.git_ref.trim(), args.inputs);
  return { run: runView(run), builds: plan.builds, note: "follow it with get_workflow_run; a build job's credits are spent once it starts" };
};

export const cancelRun = async (deps: Deps, args: { readonly run: string }) => ({ run: runView(await deps.eas.cancelRun(args.run)) });

export type ValidateArgs = {
  readonly project?: string;
  readonly workflow?: string;
  readonly gitRef?: string;
  readonly file?: FileSource;
};

const YAML_NAME = /\.ya?ml$/i;

/**
 * A workflow file checked the way `eas workflow:validate` checks it, without a
 * checkout: the file as the project's repository has it at a ref (EAS reads it
 * from GitHub, as a dispatch would), or a file by path. Read with the parse a
 * dispatch plan uses, so its build jobs are the ones a dispatch would name,
 * then checked by EAS's own validator. Runs nothing, spends nothing; a file
 * read at a ref is recorded by EAS as a revision, as a dispatch's summary
 * line already does.
 */
export const validateWorkflow = async (deps: Deps, args: ValidateArgs) => {
  const fromRef = args.workflow !== undefined || args.gitRef !== undefined;
  if (fromRef === (args.file !== undefined)) return fail(inputError("give workflow and git_ref (the file as the repository has it at that ref), or path (a file), not both"));
  if (fromRef && (args.workflow === undefined || args.gitRef === undefined)) return fail(inputError("a file at a ref needs both workflow and git_ref"));
  const app = await resolveProject(deps, args.project);
  const source = args.file === undefined ? await atRef(deps, app, args.workflow as string, checkedRef(args.gitRef as string)) : await fromFile(deps, args.file);
  if ("issues" in source) return { project: app.fullName, source: source.source, valid: false, issues: source.issues };
  const read = deps.readWorkflow(source.yaml);
  const naming = source.name !== undefined && !YAML_NAME.test(source.name) ? [`${source.name}: a workflow file's name ends in .yml or .yaml`] : [];
  if ("problem" in read) return { project: app.fullName, source: source.source, valid: false, issues: [...naming, read.problem] };
  const declared = new Set(read.jobs.map((j) => j.key));
  const needs = read.jobs.flatMap((j) => (j.needs ?? []).filter((n) => !declared.has(n)).map((n) => `jobs.${j.key}.needs: there is no job "${n}"`));
  const theirs = await deps.eas.validateWorkflow(app.id, source.yaml);
  const issues = [...naming, ...needs, ...theirs];
  return { project: app.fullName, source: source.source, valid: issues.length === 0, issues, jobs: read.jobs, builds: read.builds };
};

/** Where the YAML came from: the repository at a ref (and the commit EAS read it at), or a file with its checksum. */
type Origin =
  | { readonly workflow: string; readonly gitRef: string; readonly commit: string | null }
  | { readonly file: string; readonly sha256: string; readonly size: number };

type Source = { readonly source: Origin; readonly yaml: string; readonly name?: string } | { readonly source: Origin; readonly issues: readonly string[] };

/** The file EAS reads from the repository at the ref; a file EAS already refuses there comes back as its issues. */
const atRef = async (deps: Deps, app: RawApp, workflow: string, gitRef: string): Promise<Source> => {
  const wanted = workflow.trim().replace(/^.*\//, "");
  const known = await deps.eas.workflows(app.id);
  // A file EAS has not seen yet (a new one, on a branch) is asked for by the name given.
  const fileName = known.some((w) => w.fileName === wanted) || YAML_NAME.test(wanted) ? wanted : findWorkflow(known, wanted, app).fileName;
  try {
    const revision = await deps.eas.revisionAt(app.id, fileName, gitRef);
    return { source: { workflow: revision.fileName, gitRef, commit: revision.commitSha }, yaml: revision.yaml };
  } catch (thrown) {
    const error = asAppError(thrown);
    if (error?.kind === "input" && error.code === "VALIDATION_ERROR") return { source: { workflow: fileName, gitRef, commit: null }, issues: error.issues ?? [error.message] };
    throw thrown;
  }
};

const fromFile = async (deps: Deps, file: FileSource): Promise<Source> => {
  const read = await deps.files(file);
  const source = { file: read.name, sha256: read.sha256, size: read.size };
  try {
    return { source, yaml: new TextDecoder("utf-8", { fatal: true }).decode(read.bytes), name: read.name };
  } catch {
    return { source, issues: ["the file is not UTF-8 text"] };
  }
};
