/**
 * Live smoke test for Slides: drives the server as a real MCP client would,
 * the running service when MCP_URL is set (mcp-kit connectSmoke), else the
 * built one over stdio. Needs the Drive grant (or SMOKE_ACCOUNT's) and the Slides API enabled;
 * everything in test/ does not.
 *
 *   npm run build && npx tsx scripts/smoke-slides.ts
 *
 * The template is SMOKE_SLIDES_TEMPLATE, else the first deck find_files sees;
 * it is only READ and copied. It WRITES, on that account's Drive only: a scratch
 * folder and the copy in it, built from an outline, then both trashed.
 */
import { smoke } from "./smokeClient.js";

await smoke("slides", async (call, folderId, made, account) => {
  const templateId =
    process.env["SMOKE_SLIDES_TEMPLATE"] ||
    (await call("find_files", { mime_type: "application/vnd.google-apps.presentation", limit: 1 }))[0]?.id;
  if (!templateId) throw new Error("no deck to use as a template; set SMOKE_SLIDES_TEMPLATE");

  const { layouts } = await call("list_layouts", { account, presentation_id: templateId });
  console.log("layouts:", layouts.map((l: { displayName: string; placeholders: { type: string }[] }) => `${l.displayName} [${l.placeholders.map((p) => p.type).join(",")}]`).join("; "));
  const has = (types: readonly string[]) =>
    layouts.find((l: { placeholders: { type: string }[] }) => types.every((t) => l.placeholders.some((p) => p.type === t || (t === "TITLE" && p.type === "CENTERED_TITLE"))));
  const withBody = has(["TITLE", "BODY"]);
  const withTitle = has(["TITLE"]);
  if (!withTitle) throw new Error("the template has no layout with a title placeholder");

  const deck = await call("create_deck_from_outline", {
    account,
    template_id: templateId,
    title: "mcp slides smoke",
    folder_id: folderId,
    outline: [
      { layout: withTitle.displayName || withTitle.name, title: "Smoke test for {{client}}", notes: "Speaker notes, slide one." },
      ...(withBody ? [{ layout: withBody.displayName || withBody.name, title: "Agenda", body: ["One", "Two for {{client}}"], notes: "Second." }] : []),
    ],
  });
  made(deck.presentationId);
  console.log("created:", JSON.stringify(deck));

  console.log("filled:", JSON.stringify(await call("fill_placeholders", { account, presentation_id: deck.presentationId, values: { client: "Acme" } })));
  console.log("deck:", JSON.stringify((await call("read_deck", { account, presentation_id: deck.presentationId })).slides));
  const thumbs = await call("get_thumbnails", { account, presentation_id: deck.presentationId, size: "SMALL" });
  console.log("thumbnails:", thumbs.thumbnails.map((t: { url: string; width: number }) => `${t.width}px ${t.url.slice(0, 60)}...`).join("\n  "));
});
