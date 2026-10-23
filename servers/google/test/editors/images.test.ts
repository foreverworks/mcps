/**
 * Local images into a Doc or a deck: named in a request as "image:<name>",
 * staged on Drive shared by link for the batch only, and always taken down.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { inputFilesWith } from "@foreverworks/mcp-kit";
import { describe, expect, it } from "vitest";

import type { Deps as DriveDeps, DrivePort } from "../../src/drive/app/ports.js";
import { stagedUrl, withStagedImages } from "../../src/editors/app/images.js";
import { imageKind, imageReferences, substituteImages } from "../../src/editors/domain/images.js";
import { apiError, asAppError, fail } from "../../src/editors/domain/errors.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const failureOf = async (p: Promise<unknown>) => asAppError(await p.then(() => undefined, (e: unknown) => e));

const setup = (options: { unshareFails?: boolean } = {}) => {
  const root = mkdtempSync(join(tmpdir(), "images-"));
  writeFileSync(join(root, "chart.png"), PNG);
  writeFileSync(join(root, "notes.txt"), "not an image");
  const calls: string[] = [];
  const drive = {
    upload: async (parent: string, file: { name: string; mimeType: string }) => (calls.push(`upload ${parent} ${file.mimeType} ${file.name.replace(/[0-9a-f]{12}/, "N")}`), { id: "img1" }),
    createPermission: async (id: string, p: { type: string; role: string }) => (calls.push(`share ${id} ${p.type} ${p.role}`), { id: "anyoneWithLink" }),
    deletePermission: async (id: string, pid: string) => {
      calls.push(`unshare ${id} ${pid}`);
      if (options.unshareFails) fail(apiError(500, "Drive is down"));
    },
    update: async (id: string, patch: { trashed?: boolean }) => (calls.push(`trash ${id} ${patch.trashed}`), { id }),
  } as unknown as DrivePort;
  const deps = { drive, grant: () => ({ source: "fake", detail: "" }), readInput: inputFilesWith([root]) } as unknown as DriveDeps;
  return { deps, calls };
};

describe("image references", () => {
  it("are read and replaced only where the APIs take an image URL", () => {
    const requests = [
      { insertInlineImage: { uri: "image:chart", location: { index: 1 } } },
      { insertText: { text: "image:chart", location: { index: 1 } } },
      { replaceAllShapesWithImage: { imageUrl: "image:logo.v2", containsText: { text: "{{logo}}" } } },
    ];
    expect([...imageReferences(requests)]).toEqual(["chart", "logo.v2"]);
    expect(substituteImages(requests, { chart: "https://x/1", "logo.v2": "https://x/2" })).toEqual([
      { insertInlineImage: { uri: "https://x/1", location: { index: 1 } } },
      { insertText: { text: "image:chart", location: { index: 1 } } },
      { replaceAllShapesWithImage: { imageUrl: "https://x/2", containsText: { text: "{{logo}}" } } },
    ]);
    expect([imageKind(PNG), imageKind(Buffer.from([0xff, 0xd8, 0xff, 0])), imageKind(Buffer.from("GIF89a")), imageKind(Buffer.from("<svg"))]).toEqual([
      "image/png",
      "image/jpeg",
      "image/gif",
      undefined,
    ]);
  });
});

describe("staging", () => {
  it("uploads, shares by link, runs the batch with the link, then unshares and trashes", async () => {
    const { deps, calls } = setup();
    let sent: unknown;
    const done = await withStagedImages(deps, { chart: { path: "chart.png" } }, [{ insertInlineImage: { uri: "image:chart", location: { index: 1 } } }], async (r) => {
      sent = r;
      calls.push("batch");
      return "applied";
    });
    expect(sent).toEqual([{ insertInlineImage: { uri: stagedUrl("img1"), location: { index: 1 } } }]);
    expect(calls).toEqual(["upload root image/png mcp-staged-image-N-chart", "share img1 anyone reader", "batch", "unshare img1 anyoneWithLink", "trash img1 true"]);
    expect(done).toMatchObject({ result: "applied", images: [{ name: "chart", mimeType: "image/png", size: PNG.length, staged: "removed" }] });
  });

  it("takes the image down when the batch fails, and says so when it could not", async () => {
    const { deps, calls } = setup({ unshareFails: true });
    const failure = await failureOf(
      withStagedImages(deps, { chart: { path: "chart.png" } }, [{ createImage: { url: "image:chart" } }], async () => fail(apiError(400, "bad request"))),
    );
    expect(calls.slice(-2)).toEqual(["unshare img1 anyoneWithLink", "trash img1 true"]);
    expect(failure?.message).toMatch(/bad request; staged images not removed: chart \(Drive file img1: still shared by link/);
  });

  it("refuses a name no request uses, a request naming no image, and a file that is not an image, before uploading", async () => {
    const { deps, calls } = setup();
    const run = async () => "x";
    expect(await failureOf(withStagedImages(deps, { chart: { path: "chart.png" } }, [], run))).toMatchObject({ message: expect.stringContaining("no request uses") });
    expect(await failureOf(withStagedImages(deps, {}, [{ createImage: { url: "image:logo" } }], run))).toMatchObject({ message: expect.stringContaining("image:logo") });
    expect(await failureOf(withStagedImages(deps, { n: { path: "notes.txt" } }, [{ createImage: { url: "image:n" } }], run))).toMatchObject({ message: expect.stringContaining("not a PNG") });
    expect(calls).toEqual([]);
  });
});
