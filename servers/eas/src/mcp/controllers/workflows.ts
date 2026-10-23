import { compact, type OutputOf } from "@foreverworks/mcp-kit";
import { z } from "zod";

import { waitForRun } from "../../app/usecases/wait.js";
import { cancelRun, dispatch, type DispatchPlan, getRun, jobLogs, listRuns, listWorkflows, validateWorkflow } from "../../app/usecases/workflows.js";
import { type ArgsOf, id, limit, lines, project } from "../args.js";
import { handled } from "../envelope.js";
import { RUNS_OUTPUT, VALIDATE_OUTPUT, WORKFLOWS_OUTPUT } from "../outputs.js";
import type { Deps } from "../../app/ports.js";
import type { Registrar } from "./types.js";

const RUN_STATUS = ["NEW", "WAITING", "IN_PROGRESS", "ACTION_REQUIRED", "SUCCESS", "FAILURE", "CANCELED"] as const;

const workflow = z.string().trim().min(1).describe('The workflow file name, e.g. "ios-build.yml" (the extension may be left out).');

const LIST_WORKFLOWS = { project };

const LIST_RUNS = {
  project,
  workflow: workflow.optional(),
  status: z.enum(RUN_STATUS).optional(),
  git_ref: z.string().trim().min(1).optional().describe('Only runs requested at this ref, e.g. "refs/heads/main".'),
  limit: limit(10, 50),
  cursor: z.string().trim().min(1).optional().describe("nextCursor from the previous call, to read on."),
  reasons: z.boolean().default(true).describe("Read each FAILURE run's failed jobs' logs for its one-line reason (a request or two per failed run)."),
};

const GET_RUN = { run: id("The workflow run id."), lines: lines(0) };

const WAIT = {
  run: id("A workflow run id, from dispatch_workflow or list_workflow_runs.").optional(),
  build: id("A build id, from list_builds or a run's build job.").optional(),
  minutes: z.number().int().min(1).max(14).default(10).describe("How long to wait at most (a request over HTTP is cut at 15 minutes by default); call again to keep waiting."),
  lines: lines(0),
};

const JOB_LOGS = {
  job: id("The workflow job id (get_workflow_run lists them)."),
  step: z.string().trim().min(1).optional().describe("A step's name, or part of it. Default: the failed step, else the last."),
  lines: z.number().int().min(1).max(500).default(60).describe("How many of the step's last lines."),
};

export const DISPATCH = {
  project,
  workflow,
  git_ref: z
    .string()
    .trim()
    .min(1)
    .describe('A ref the project\'s GitHub repository already has: a branch ("main"), "refs/heads/<branch>", "refs/tags/<tag>" or a commit hash.'),
  inputs: z.record(z.string(), z.unknown()).optional().describe("The workflow_dispatch inputs the file declares, by name."),
};

const CANCEL_RUN = { run: id("The workflow run id.") };

/** A file argument's three fields, with the sentences derived from the server's own roots (packages/mcp-kit, inputFile.ts). */
const validateShape = (files: Deps["files"]) => ({
  project,
  workflow: workflow.optional().describe('With git_ref: the workflow file as the repository has it there, e.g. "ios-build.yml"; a file EAS has not run yet works too.'),
  git_ref: z.string().trim().min(1).optional().describe('With workflow: a branch ("main"), "refs/heads/<branch>", "refs/tags/<tag>" or a commit hash the repository already has.'),
  path: z.string().optional().describe(`Instead of workflow and git_ref, a workflow file: ${files.where}. Links are refused.`),
  content_base64: z.string().optional().describe("Instead of path: the file's bytes as standard base64, only as a script that read the file wrote them, never typed. Needs sha256."),
  sha256: z.string().optional().describe("Hex SHA-256 of the source file, as sha256sum prints it. Required with content_base64, checked with path."),
});

/** The plan the guard attached (policy.ts `resolve`): the revision the summary line named is the one that runs. */
const planIn = (args: object): DispatchPlan | undefined => (args as { readonly plan?: DispatchPlan }).plan;

export const registerWorkflows: Registrar = (server, deps) => {
  server.registerTool(
    "list_workflows",
    {
      title: "List workflows",
      description: "A project's EAS workflow files (.eas/workflows/*.yml), by file name: what list_workflow_runs and dispatch_workflow take.",
      inputSchema: LIST_WORKFLOWS,
      outputSchema: WORKFLOWS_OUTPUT,
    },
    handled((a: ArgsOf<typeof LIST_WORKFLOWS>): Promise<OutputOf<typeof WORKFLOWS_OUTPUT>> => listWorkflows(deps, compact(a))),
  );

  server.registerTool(
    "list_workflow_runs",
    {
      title: "List workflow runs",
      description:
        "A project's workflow runs, newest first, optionally of one workflow file, status or ref: status, ref, commit, trigger (a " +
        "GitHub push, a schedule, a dispatch) and who. A FAILURE run carries reason: the failed job, its failed step and the line that " +
        'says why, read from the job\'s log (e.g. "submit_ios > Prepare credentials: eas-cli failed to resolve submission config ...").',
      inputSchema: LIST_RUNS,
      outputSchema: RUNS_OUTPUT,
    },
    handled((a: ArgsOf<typeof LIST_RUNS>): Promise<OutputOf<typeof RUNS_OUTPUT>> =>
      listRuns(deps, { limit: a.limit, reasons: a.reasons, ...compact({ project: a.project, workflow: a.workflow, status: a.status, gitRef: a.git_ref, cursor: a.cursor }) }),
    ),
  );

  server.registerTool(
    "get_workflow_run",
    {
      title: "Get workflow run",
      description:
        "One workflow run with its jobs: each job's type, status and outputs (build_id, fingerprint hashes, app_build_version...) and " +
        "artifacts. When it failed: reason in one line, and failures per job (the job's own error, which for an App Store upload is " +
        "Apple's text, else its failed step and the line that says why); lines adds each failed step's tail.",
      inputSchema: GET_RUN,
    },
    handled((a: ArgsOf<typeof GET_RUN>) => getRun(deps, a)),
  );

  server.registerTool(
    "wait_for_run",
    {
      title: "Wait for a run or a build",
      description:
        "Wait until a workflow run or a build ends (give run or build), looking every 15 s, and answer as get_workflow_run or " +
        "get_build would then: the outcome and, when it failed, the reason. While it waits, a client that asks for progress hears " +
        "where it stands (jobs done, the job running). A run that waits for someone's approval, or one still going after minutes, " +
        "answers done: false with its state; cancelling the call only stops the waiting, never the run.",
      inputSchema: WAIT,
    },
    handled((a: ArgsOf<typeof WAIT>) => waitForRun(deps, a)),
  );

  server.registerTool(
    "get_job_logs",
    {
      title: "Get job logs",
      description:
        "A workflow job's log, by step: every step with its result and size, and the last lines of one step (the failed one by " +
        "default). What eas workflow:logs --all-steps prints, without the noise.",
      inputSchema: JOB_LOGS,
    },
    handled((a: ArgsOf<typeof JOB_LOGS>) => jobLogs(deps, compact(a))),
  );

  const VALIDATE = validateShape(deps.files);
  server.registerTool(
    "validate_workflow",
    {
      title: "Validate workflow",
      description:
        "Check an EAS workflow file before it runs, the way eas workflow:validate does, without a checkout: the file as the " +
        "project's repository has it at a ref (workflow and git_ref; EAS reads it from GitHub, as a dispatch would), or a file " +
        "(path). Answers valid, the issues (YAML that does not parse, a needs: naming no job, and every problem EAS's own " +
        "validator names, field by field), the jobs, and the build jobs a dispatch would spend credits on. Runs nothing, spends " +
        `nothing. ${deps.files.help}`,
      inputSchema: VALIDATE,
      outputSchema: VALIDATE_OUTPUT,
    },
    handled((a: ArgsOf<typeof VALIDATE>): Promise<OutputOf<typeof VALIDATE_OUTPUT>> => {
      const file = a.path === undefined && a.content_base64 === undefined ? undefined : compact({ path: a.path, contentBase64: a.content_base64, sha256: a.sha256 });
      return validateWorkflow(deps, compact({ project: a.project, workflow: a.workflow, gitRef: a.git_ref, file }));
    }),
  );

  server.registerTool(
    "dispatch_workflow",
    {
      title: "Dispatch workflow",
      description:
        "Run an EAS workflow file at a git ref the project's GitHub repository already has. EAS reads the file and the code from " +
        "GitHub; nothing local is uploaded. A build job spends EAS build credits; the summary line names the project, the file, the " +
        "ref and each build job's platform and profile. Answers with the new run; follow it with get_workflow_run.",
      inputSchema: DISPATCH,
    },
    handled((a: ArgsOf<typeof DISPATCH>) => {
      const plan = planIn(a);
      return dispatch(deps, { workflow: a.workflow, git_ref: a.git_ref, ...compact({ project: a.project, inputs: a.inputs, plan }) });
    }),
  );

  server.registerTool(
    "cancel_workflow_run",
    {
      title: "Cancel workflow run",
      description: "Cancel a workflow run that has not ended, with its running jobs (a build in progress stops spending).",
      inputSchema: CANCEL_RUN,
    },
    handled((a: ArgsOf<typeof CANCEL_RUN>) => cancelRun(deps, a)),
  );
};
