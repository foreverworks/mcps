/**
 * Live smoke test: spawns the BUILT server over stdio and drives it as a real
 * MCP client would. Needs the account's key pair; everything in test/ does not.
 *
 *   npm run build -w @foreverworks/mcp-porkbun
 *   PORKBUN_API_KEY_FILE=... PORKBUN_SECRET_API_KEY_FILE=... npx tsx scripts/smoke.ts
 *   (or PORKBUN_API_KEY / PORKBUN_SECRET_API_KEY; only PORKBUN_* variables reach the server)
 *
 * READ-ONLY: ping, list_domains, get_balance. It calls no write and no money
 * tool, not even as a dry run: a money call is one a user confirms, and a
 * smoke run from a shell has nobody to ask.
 */
import { ACCESS_META, connectSmoke, getDefaultEnvironment } from "@foreverworks/mcp-kit";

type Result = { readonly isError?: boolean; readonly content: readonly { readonly text?: string }[] };

const READS = [
  ["ping", {}],
  ["list_domains", {}],
  ["get_balance", {}],
] as const;

const porkbunEnv = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[0].startsWith("PORKBUN_") && entry[1] !== undefined),
);

const main = async (): Promise<void> => {
  // Over stdio the child gets the SDK's default environment plus the PORKBUN_ keys only.
  const client = await connectSmoke({ env: { ...getDefaultEnvironment(), ...porkbunEnv } });

  const { tools } = await client.listTools();
  const money = tools.filter((t) => t._meta?.[ACCESS_META] === "money").map((t) => t.name);
  console.log(`${tools.length} tools, ${money.length} of them money (a client confirms each call): ${money.join(", ")}`);

  const failed: string[] = [];
  for (const [name, args] of READS) {
    const result = (await client.callTool({ name, arguments: args })) as Result;
    const text = result.content[0]?.text ?? "";
    console.log(`\n${name}${result.isError === true ? " FAILED" : ""}: ${text.slice(0, 400)}`);
    if (result.isError === true) failed.push(name);
  }

  await client.close();
  if (failed.length > 0) {
    console.error(`\nfailed: ${failed.join(", ")}`);
    process.exit(1);
  }
};

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
