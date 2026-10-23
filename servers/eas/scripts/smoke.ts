/**
 * Live smoke test: drives the built server over the real MCP protocol, as a
 * client would. Needs an Expo token; everything in test/ needs none.
 *
 *   npm run build -w @foreverworks/mcp-eas
 *   EXPO_TOKEN_FILE=<file> npx tsx scripts/smoke.ts [options]          # stdio
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<file> npx tsx scripts/smoke.ts   # a running service
 *
 * READ-ONLY, ALWAYS: it never dispatches a workflow, starts or cancels a build,
 * submits, republishes or changes a credential, so it spends no EAS credits.
 * It calls health, list_projects, list_builds, get_build, list_workflows,
 * list_workflow_runs (with reasons), get_workflow_run and get_job_logs on the
 * newest failed run, list_submissions and get_submission on the newest errored
 * one, audit_credentials, list_fingerprints and list_updates. Then the policy:
 * dispatch_workflow must be listed as `money` (destructive), and nothing else.
 * It is never called. Last, an unknown argument must be refused.
 *
 *   --project <name>     the project (default: the only one the token sees)
 *   --workflow <file>    the workflow whose runs to read (default: every run)
 *   --expect-key <id>    fail unless every iOS bundle has this submit key
 */
import { ACCESS_META, connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const option = (name: string): string | undefined => {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
};

const show = (label: string, value: unknown, max = 900): void => console.log(`${label}:`, JSON.stringify(value).slice(0, max));

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? "ok" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const main = async (): Promise<void> => {
  const client = await connectSmoke();
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const started = Date.now();
    const out = toolJson(await client.callTool({ name, arguments: args }));
    console.log(`  (${name}: ${Date.now() - started} ms)`);
    return out;
  };
  const project = option("--project");
  const p = project === undefined ? {} : { project };

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).sort().join(", "));

  const health = await call("health");
  show("\nhealth", health);
  check(health.ok === true, "health is ok");
  if (health.ok !== true) {
    await client.close();
    process.exit(1);
  }
  show("list_projects", await call("list_projects"));

  const builds = await call("list_builds", { ...p, limit: 5 });
  show("\nlist_builds", builds);
  check(Array.isArray(builds.builds), "list_builds answers builds");
  const first = builds.builds?.[0];
  if (first !== undefined) show("get_build", await call("get_build", { build: first.id }));

  show("\nlist_workflows", await call("list_workflows", p));
  const workflow = option("--workflow");
  const runs = await call("list_workflow_runs", { ...p, ...(workflow === undefined ? {} : { workflow }), limit: 5 });
  show("list_workflow_runs", runs, 2500);
  check(Array.isArray(runs.runs), "list_workflow_runs answers runs");
  const failed = (runs.runs ?? []).find((r: { status: string }) => r.status === "FAILURE");
  if (failed !== undefined) {
    check(typeof failed.reason === "string" && failed.reason.length > 0, `the failed run ${failed.id} says why: ${failed.reason}`);
    const run = await call("get_workflow_run", { run: failed.id, lines: 5 });
    show("get_workflow_run", run, 2500);
    const job = (run.jobs ?? []).find((j: { status: string; hasLog: boolean }) => j.status === "FAILURE" && j.hasLog);
    if (job !== undefined) show("get_job_logs", await call("get_job_logs", { job: job.id, lines: 8 }), 1500);
  }

  const submissions = await call("list_submissions", { ...p, limit: 5 });
  show("\nlist_submissions", submissions, 1500);
  const errored = (submissions.submissions ?? []).find((s: { status: string }) => s.status === "ERRORED");
  if (errored !== undefined) show("get_submission", await call("get_submission", { submission: errored.id }), 1500);

  const audit = await call("audit_credentials", p);
  show("\naudit_credentials", audit, 3000);
  check(Array.isArray(audit.identifiers), "audit_credentials answers per identifier");
  const expected = option("--expect-key");
  if (expected !== undefined) {
    const ios = (audit.identifiers ?? []).filter((i: { platform: string }) => i.platform === "ios");
    check(ios.length > 0, "the audit covers iOS bundles");
    for (const b of ios) check(b.submitKey?.keyId === expected, `${b.identifier} submits with ${expected} (has ${b.submitKey?.keyId ?? "none"})`);
  }

  show("\nlist_fingerprints", await call("list_fingerprints", { ...p, limit: 3 }), 1200);
  show("list_updates", await call("list_updates", p), 1500);

  // The policy, as a client sees it: the one tool that spends credits is money, and says so to the client.
  const money = tools.filter((t) => t._meta?.[ACCESS_META] === "money").map((t) => t.name);
  check(money.length === 1 && money[0] === "dispatch_workflow", `only dispatch_workflow is money (${money.join(", ")})`);
  check(tools.find((t) => t.name === "dispatch_workflow")?.annotations?.destructiveHint === true, "dispatch_workflow is marked destructive");
  // The kit makes every input strict: a misspelt argument is a protocol error naming it, not a default silently used.
  const unknown = (await client.callTool({ name: "list_builds", arguments: { ...p, limitt: 3 } })) as { isError?: boolean; content: { text: string }[] };
  check(unknown.isError === true && (unknown.content[0]?.text ?? "").includes("limitt"), "an unknown argument is refused, by name");

  await client.close();
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:\n- ${failures.join("\n- ")}`);
    process.exit(1);
  }
  console.log("\nall checks passed");
};

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
