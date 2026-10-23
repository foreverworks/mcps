import { z } from "zod";

/**
 * What the list tools answer, as MCP output schemas: a client gets each list as
 * typed structured content beside the JSON text, and the guard fails a result
 * that does not match (packages/mcp-kit, serve/guard.ts). Nullability is the
 * views' (domain/views.ts), which take it from EAS's GraphQL schema: null where
 * "none" is the answer, a field left out where it would always be empty.
 * Statuses and platforms are EAS's own words, typed as text. The controllers
 * declare their results as these types (the kit's OutputOf), so a view that
 * changes a field's shape fails the typecheck.
 */

const text = z.string();
const maybe = z.string().nullable();
const page = { nextOffset: z.number().int().optional() };

export const PROJECTS_OUTPUT = z.strictObject({
  actor: z.strictObject({ kind: text, name: text }),
  accounts: z.array(z.strictObject({ name: text, projects: z.array(z.strictObject({ id: text, fullName: text, name: text })) })),
  defaultProject: text.optional(),
});

const buildSummary = z.strictObject({
  id: text,
  status: text,
  platform: text,
  profile: maybe,
  appIdentifier: maybe,
  appVersion: maybe,
  buildNumber: maybe,
  distribution: maybe,
  gitCommitHash: maybe,
  fingerprint: maybe,
  runtimeVersion: maybe,
  createdAt: text,
  completedAt: maybe,
  by: maybe,
  error: maybe,
});

export const BUILDS_OUTPUT = z.strictObject({ project: text, builds: z.array(buildSummary), ...page });

export const WORKFLOWS_OUTPUT = z.strictObject({
  project: text,
  workflows: z.array(z.strictObject({ fileName: text, name: maybe, updatedAt: text })),
});

const run = z.strictObject({
  id: text,
  workflow: text,
  status: text,
  gitRef: maybe,
  gitCommitHash: maybe,
  gitCommitMessage: maybe,
  trigger: maybe,
  schedule: text.optional(),
  by: maybe,
  createdAt: text,
  updatedAt: text,
  errors: z.array(text).optional(),
  reason: text.optional(),
});

export const RUNS_OUTPUT = z.strictObject({ project: text, runs: z.array(run), nextCursor: text.optional() });

const submission = z.strictObject({
  id: text,
  status: text,
  platform: text,
  createdAt: text,
  completedAt: maybe,
  build: z.strictObject({ id: text, appIdentifier: maybe, appVersion: maybe, buildNumber: maybe, profile: maybe }).nullable(),
  ascAppId: text.optional(),
  track: text.optional(),
  releaseStatus: maybe.optional(),
  rollout: z.number().nullable().optional(),
  by: maybe,
  workflowRunId: text.optional(),
  workflowJob: text.optional(),
  error: maybe,
});

export const SUBMISSIONS_OUTPUT = z.strictObject({ project: text, submissions: z.array(submission), ...page });

export const FINGERPRINTS_OUTPUT = z.strictObject({
  project: text,
  fingerprints: z.array(
    z.strictObject({
      hash: text,
      createdAt: text,
      buildCount: z.number().int(),
      updateCount: z.number().int(),
      builds: z.array(z.strictObject({ id: text, platform: text, buildProfile: maybe, status: text, appBuildVersion: maybe, createdAt: text })),
      updates: z.array(z.strictObject({ group: text, platform: text, branch: text, createdAt: text })),
    }),
  ),
});

const update = z.strictObject({
  group: text,
  platform: text,
  runtimeVersion: text,
  createdAt: text,
  message: maybe,
  gitCommitHash: maybe,
  rolloutPercentage: z.number().optional(),
  rollBackToEmbedded: z.literal(true).optional(),
  by: maybe,
});

export const UPDATES_OUTPUT = z.strictObject({
  project: text,
  channels: z.array(
    z.strictObject({
      name: text,
      branches: z.array(text),
      paused: z.literal(true).optional(),
      protected: z.literal(true).optional(),
      production: z.literal(true).optional(),
    }),
  ),
  branches: z.array(z.strictObject({ name: text, latest: z.array(update) })),
});

export const VALIDATE_OUTPUT = z.strictObject({
  project: text,
  source: z.union([
    z.strictObject({ workflow: text, gitRef: text, commit: maybe }),
    z.strictObject({ file: text, sha256: text, size: z.number().int() }),
  ]),
  valid: z.boolean(),
  issues: z.array(text),
  jobs: z.array(z.strictObject({ key: text, type: maybe, needs: z.array(text).optional() })).optional(),
  builds: z.array(z.strictObject({ key: text, platform: text, profile: text, conditional: z.boolean() })).optional(),
});
