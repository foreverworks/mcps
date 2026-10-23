/**
 * Every workspace's vitest setup file: a test cannot reach anyone's state.
 *
 * A test that forgets to hand in its own directory could reach real state
 * through a cached token. So before any test file runs:
 * HOME is a new empty directory, the environment is cut down to what a process
 * needs to run (an ALLOWLIST, so a new server's variables are gone without
 * anyone remembering to add them here), the time zone is UTC, and fetch refuses
 * anything but loopback. A test that needs the network stubs fetch itself
 * (vi.stubGlobal or a fetch argument); one that forgets gets a loud failure
 * instead of a real call.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const KEEP = new Set(["PATH", "TMPDIR", "TEMP", "TMP", "LANG", "LANGUAGE", "TERM", "SHELL", "USER", "LOGNAME", "PWD", "CI", "FORCE_COLOR", "NO_COLOR", "COLORTERM"]);
const KEEP_PREFIXES = ["VITEST", "NODE_", "npm_", "LC_", "GITHUB_", "RUNNER_", "TSX_"];

for (const name of Object.keys(process.env)) {
  if (!KEEP.has(name) && !KEEP_PREFIXES.some((prefix) => name.startsWith(prefix))) delete process.env[name];
}

const home = mkdtempSync(join(tmpdir(), "mcps-test-home-"));
process.env["HOME"] = home;
process.env["XDG_CONFIG_HOME"] = join(home, ".config");
process.env["XDG_STATE_HOME"] = join(home, ".local", "state");
// Dates are read in the process's zone where a server is not told one; the same everywhere.
process.env["TZ"] = "UTC";

const realFetch = globalThis.fetch;
globalThis.fetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]") return realFetch(input, init);
  return Promise.reject(new Error(`test isolation: a test tried to reach ${url.origin} without stubbing fetch`));
};

// The guard checks itself before any test file runs, in every workspace that uses this setup: a
// fetch to a non-loopback host must be refused here (the URL is judged before any connection),
// and HOME must be the empty directory made above. A workspace where either fails never gets to
// run a test, so an unisolated test cannot pass unnoticed.
await globalThis.fetch("https://example.invalid/").then(
  () => {
    throw new Error("test isolation is not in force: a fetch to a non-loopback host went through");
  },
  (reason: unknown) => {
    // Refused by the guard above, not by the network: a DNS failure would look like a refusal too.
    if (!String(reason).includes("test isolation")) throw new Error(`test isolation is not in force: the guard did not refuse the fetch (${String(reason).slice(0, 80)})`);
  },
);
if (process.env["HOME"] !== home) throw new Error("test isolation is not in force: HOME is not the test's own directory");
