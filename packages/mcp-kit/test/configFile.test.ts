import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { readConfigFile } from "../src/configFile.js";
import { issuesText } from "../src/issues.js";

const schema = z.object({ client_id: z.string().min(1), client_secret: z.string().min(1) });
const refuse = (message: string): never => {
  throw new Error(message);
};
const messageOf = (p: Promise<unknown>): Promise<string> => p.then(() => "resolved", (e: unknown) => (e as Error).message);

describe("readConfigFile", () => {
  it("reads and parses app.json", async () => {
    const path = join(await mkdtemp(join(tmpdir(), "kit-config-")), "app.json");
    await writeFile(path, JSON.stringify({ client_id: "c", client_secret: "s", extra: 1 }));
    expect(await readConfigFile(path, schema, refuse)).toEqual({ client_id: "c", client_secret: "s" });
  });

  it("never quotes the file: not JSON, the wrong shape, or unreadable", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kit-config-"));
    const broken = join(dir, "broken.json");
    await writeFile(broken, '{"client_id": "c", "client_secret": s3cr3t-value}');
    expect(await messageOf(readConfigFile(broken, schema, refuse))).toBe(`app config at ${broken} is not JSON`);
    const shape = join(dir, "shape.json");
    await writeFile(shape, JSON.stringify({ client_id: 42, client_secret: "s3cr3t-value" }));
    const said = await messageOf(readConfigFile(shape, schema, refuse));
    expect(said).toMatch(/lacks or mistypes: client_id: /);
    expect(said).not.toContain("s3cr3t");
    expect(await messageOf(readConfigFile(join(dir, "absent.json"), schema, refuse))).toBe(`app config at ${join(dir, "absent.json")} cannot be read (ENOENT)`);
  });
});

describe("issuesText", () => {
  it("names each path with its message, the root as (root), the first few only", () => {
    const result = z.array(z.number()).safeParse(["a", "b", "c", "d", "e", "f", "g"]);
    expect(result.success).toBe(false);
    if (!result.success) expect(issuesText(result.error, 2)).toMatch(/^0: .*; 1: .*; and 5 more$/);
    const root = z.number().safeParse("x");
    if (!root.success) expect(issuesText(root.error)).toMatch(/^\(root\): /);
  });
});
