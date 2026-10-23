/**
 * Latency of a running server, per tool: p50, p95, min, max over N calls.
 *
 *   npx tsx scripts/bench.ts <port> <tokenFile> <n> <gapMs> <tool> '<json args>' [<tool> '<json args>' ...]
 *
 * READ-ONLY tools only: this calls the tool N times against the real account.
 * `gapMs` spaces the calls, because an agent's calls arrive seconds apart and a
 * back-to-back loop measures a warm connection the agent never gets.
 * Output: one JSON line per tool.
 */
import { readFileSync } from "node:fs";

const [port, tokenFile, n, gap, ...pairs] = process.argv.slice(2);
if (!port || !tokenFile || !n || !gap || pairs.length === 0 || pairs.length % 2 !== 0) {
  console.error("usage: bench.ts <port> <tokenFile> <n> <gapMs> <tool> '<json args>' ...");
  process.exit(2);
}
const token = readFileSync(tokenFile, "utf8").trim();
const url = `http://127.0.0.1:${port}/mcp`;

const call = async (name: string, args: unknown): Promise<{ ms: number; ok: boolean; bytes: number }> => {
  const started = performance.now();
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify(
      name === "tools/list"
        ? { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }
        : { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
    ),
  });
  const text = await res.text();
  const ms = performance.now() - started;
  const body = JSON.parse(text) as { result?: { isError?: boolean } };
  return { ms, ok: res.status === 200 && body.result !== undefined && body.result.isError !== true, bytes: text.length };
};

const quantile = (sorted: readonly number[], q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const bench = async (tool: string, args: unknown) => {
  const runs: { ms: number; ok: boolean; bytes: number }[] = [];
  for (let i = 0; i < Number(n); i += 1) {
    if (i > 0) await sleep(Number(gap));
    runs.push(await call(tool, args));
  }
  const ms = runs.map((r) => r.ms).sort((a, b) => a - b);
  return {
    port: Number(port),
    tool,
    n: runs.length,
    gapMs: Number(gap),
    failed: runs.filter((r) => !r.ok).length,
    p50: Math.round(quantile(ms, 0.5)),
    p95: Math.round(quantile(ms, 0.95)),
    min: Math.round(ms[0] ?? NaN),
    max: Math.round(ms[ms.length - 1] ?? NaN),
    bytes: runs[0]?.bytes ?? 0,
  };
};

const tools = Array.from({ length: pairs.length / 2 }, (_, i) => [pairs[2 * i]!, JSON.parse(pairs[2 * i + 1]!) as unknown] as const);
for (const [tool, args] of tools) console.log(JSON.stringify(await bench(tool, args)));
