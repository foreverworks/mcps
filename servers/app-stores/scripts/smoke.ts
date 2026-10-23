/**
 * Live smoke test: drives the server as a real MCP client would, against App
 * Store Connect and Google Play with your credentials (or a running service,
 * with MCP_URL). Reads only: it never replies to a review.
 *
 *   npm run build -w @foreverworks/mcp-app-stores
 *   ASC_KEY_ID=... ASC_ISSUER_ID=... ASC_PRIVATE_KEY_FILE=... PLAY_SERVICE_ACCOUNT_FILE=... PLAY_PACKAGES=... npx tsx scripts/smoke.ts
 *   MCP_URL=http://127.0.0.1:<port>/mcp MCP_TOKEN_FILE=<token file> npx tsx scripts/smoke.ts
 *
 * health; then, for each configured store, three reviews; and three pieces of
 * TestFlight feedback for the first app the key sees.
 */
import { connectSmoke, toolJson } from "@foreverworks/mcp-kit";

const failures: string[] = [];
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? "ok" : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
};

const main = async (): Promise<void> => {
  const client = await connectSmoke({ name: "smoke" });
  const call = async (name: string, args: Record<string, unknown> = {}) => toolJson(await client.callTool({ name, arguments: args }));

  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));
  const health = await call("health");
  console.log("health:", JSON.stringify(health));
  check(health.ok === true, "every configured store answers");

  const app = health.appStore?.apps?.[0]?.bundleId as string | undefined;
  if (app !== undefined) {
    const reviews = await call("list_app_store_reviews", { app, limit: 3 });
    check(Array.isArray(reviews.reviews), `App Store reviews of ${app}: ${reviews.reviews?.length ?? reviews.error?.message}`);
    const feedback = await call("list_testflight_feedback", { app, limit: 3 });
    check(Array.isArray(feedback.feedback), `TestFlight feedback of ${app}: ${feedback.feedback?.length ?? feedback.error?.message}`);
  }
  for (const p of (health.play?.packages ?? []) as { package: string }[]) {
    const reviews = await call("list_play_reviews", { package: p.package, limit: 3 });
    check(Array.isArray(reviews.reviews), `Play reviews of ${p.package}: ${reviews.reviews?.length ?? reviews.error?.message}`);
  }

  await client.close();
  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed:\n  ${failures.join("\n  ")}`);
    process.exit(1);
  }
  console.log("\nsmoke: every check passed");
};

main().catch((error: unknown) => {
  console.error("smoke failed:", error);
  process.exit(1);
});
