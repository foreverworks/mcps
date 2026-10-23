import { compact } from "@foreverworks/mcp-kit";

import type { AscReviewQuery, Deps } from "../ports.js";
import { resolveAscApp, resolvePackage } from "./apps.js";

/** An app's App Store reviews, newest first by default, each with its reply if it has one. */
export const listAppStoreReviews = async (deps: Deps, args: { readonly app?: string } & AscReviewQuery) => {
  const app = await resolveAscApp(deps, args.app);
  const { app: _app, ...query } = args;
  const page = await deps.appStore.reviews(app.id, query);
  return { app: { id: app.id, bundleId: app.bundleId, name: app.name }, reviews: page.items, ...compact({ nextCursor: page.nextCursor }) };
};

/**
 * A package's Play reviews: Google's API returns only the reviews written or
 * changed in the last seven days, newest first (older ones are in Play
 * Console's monthly reports).
 */
export const listPlayReviews = async (deps: Deps, args: { readonly package?: string; readonly limit: number; readonly cursor?: string; readonly translateTo?: string }) => {
  const packageName = resolvePackage(deps, args.package);
  const page = await deps.play.reviews(packageName, compact({ limit: args.limit, cursor: args.cursor, translateTo: args.translateTo }));
  return { package: packageName, reviews: page.items, ...compact({ nextCursor: page.nextCursor }), window: "reviews written or changed in the last 7 days (Google's limit)" };
};
