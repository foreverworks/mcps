# @foreverworks/mcp-app-stores

## 0.1.0

The first release. What people say about your app in both stores: App Store and Google Play reviews with the reply you gave each, and TestFlight feedback, with the crash log behind a crash report. It reads App Store Connect with a team API key and Google Play with a service account, both from files.

Its `write` tools publish a reply to a review, in your name and in public: `reply_app_store_review` and `reply_play_review`. Neither replaces a reply you already gave unless you ask it to. Nothing here moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
