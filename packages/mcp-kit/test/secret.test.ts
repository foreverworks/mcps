import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readSecret } from "../src/secret.js";

const SOURCE = { file: "X_KEY_FILE", value: "X_KEY" } as const;
const refuse = (message: string): never => {
  throw new Error(message);
};
const messageOf = (p: Promise<unknown>): Promise<string> => p.then(() => "resolved", (e: unknown) => (e as Error).message);

describe("readSecret", () => {
  it("reads the file, trimmed, and prefers it to the variable", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "kit-secret-")), "key");
    await writeFile(path, "from-file\n");
    await expect(readSecret({ X_KEY_FILE: path, X_KEY: "from-env" }, SOURCE, refuse)).resolves.toBe("from-file");
  });

  it("falls back to the variable, and is undefined when neither is set", async () => {
    await expect(readSecret({ X_KEY: " from-env " }, SOURCE, refuse)).resolves.toBe("from-env");
    await expect(readSecret({ X_KEY_FILE: "  ", X_KEY: "" }, SOURCE, refuse)).resolves.toBeUndefined();
  });

  it("fails on a named file that is missing or empty, without falling back and without quoting it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kit-secret-"));
    expect(await messageOf(readSecret({ X_KEY_FILE: join(dir, "absent"), X_KEY: "from-env" }, SOURCE, refuse))).toMatch(/X_KEY_FILE names .*absent, which cannot be read \(ENOENT\)/);
    await writeFile(join(dir, "empty"), "\n");
    expect(await messageOf(readSecret({ X_KEY_FILE: join(dir, "empty") }, SOURCE, refuse))).toMatch(/which is empty$/);
  });
});
