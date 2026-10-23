import { parse } from "yaml";

import type { WorkflowBuildJob, WorkflowJobDecl, WorkflowRead } from "../domain/schema.js";

/**
 * An EAS workflow file, read from its YAML: its jobs, and the build jobs a
 * dispatch will spend EAS build credits on. One reading serves both the
 * dispatch plan (the line a user confirms) and validate_workflow, so what a
 * validation says a file builds is what a dispatch of it would name.
 *
 * A job of type `build` (or `repack`, which builds from another build) names
 * its platform and profile under `params`. It is conditional when it carries
 * an `if:`, or needs a job that is: a skipped job skips everything that needs
 * it, so whether it builds is decided at run time (a fingerprint-gated
 * workflow builds only when no build has the fingerprint yet).
 */

const BUILDS = new Set(["build", "repack"]);

/**
 * The options eas-cli parses a workflow file with, "in sync with backend parser
 * options" (eas-cli 25.3, commandUtils/workflow/parse.js): merge keys (`<<:`)
 * on, so a job built from an anchor reads as EAS reads it.
 */
const PARSE_OPTIONS = { merge: true, maxAliasCount: 50 } as const;

type Job = {
  readonly type?: unknown;
  readonly uses?: unknown;
  readonly if?: unknown;
  readonly needs?: unknown;
  readonly params?: { readonly platform?: unknown; readonly profile?: unknown };
};

const asList = (value: unknown): readonly string[] =>
  typeof value === "string" ? [value] : Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

const isMapping = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Every job with its type and what it needs, and the build jobs; or, for a file nothing could run, why. */
export const readWorkflow = (yaml: string): WorkflowRead => {
  let doc: unknown;
  try {
    doc = parse(yaml, PARSE_OPTIONS);
  } catch (cause) {
    return { problem: `the file is not valid YAML: ${(cause as Error).message}` };
  }
  if (doc === null || doc === undefined || (isMapping(doc) && Object.keys(doc).length === 0)) return { problem: "the file is empty or holds only comments" };
  if (!isMapping(doc)) return { problem: "the file is not a mapping of keys (name, on, jobs ...)" };
  const jobs = doc["jobs"];
  if (!isMapping(jobs)) return { problem: "the file has no jobs: mapping" };
  const jobOf = (key: string): Job | undefined => (isMapping(jobs[key]) ? (jobs[key] as Job) : undefined);
  const conditional = new Map<string, boolean>();
  const isConditional = (key: string, seen: ReadonlySet<string>): boolean => {
    const known = conditional.get(key);
    if (known !== undefined) return known;
    const job = jobOf(key);
    if (job === undefined || seen.has(key)) return false;
    const next = new Set(seen).add(key);
    const result = job.if !== undefined || asList(job.needs).some((need) => isConditional(need, next));
    conditional.set(key, result);
    return result;
  };
  const decls: WorkflowJobDecl[] = Object.keys(jobs).map((key) => {
    const job = jobOf(key);
    const needs = asList(job?.needs);
    const type = typeof job?.type === "string" ? job.type : typeof job?.uses === "string" ? `uses ${job.uses}` : null;
    return { key, type, ...(needs.length === 0 ? {} : { needs }) };
  });
  const builds: WorkflowBuildJob[] = Object.keys(jobs).flatMap((key) => {
    const job = jobOf(key);
    if (job === undefined || typeof job.type !== "string" || !BUILDS.has(job.type)) return [];
    return [
      {
        key,
        platform: typeof job.params?.platform === "string" ? job.params.platform : "(platform not named in the file)",
        profile: typeof job.params?.profile === "string" ? job.params.profile : "(default profile)",
        conditional: isConditional(key, new Set()),
      },
    ];
  });
  return { jobs: decls, builds };
};
