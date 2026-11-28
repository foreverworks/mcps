# @foreverworks/mcp-app-stores

## 0.2.0

### Minor Changes

- ab2c527: `get_testflight_crash_log` now says why the app died, not just how the log begins. The answer picks out the exception and termination lines, Application Specific Information, the Last Exception Backtrace and the crashed thread's frames, from Apple's text format and from its JSON `.ips` format. Before, it showed the first 40 lines, which in a real report end long before the crashed thread, so a client that could not open the server's outbox could not diagnose anything. `from` and `count` read any other lines of the log.

### Patch Changes

- Updated dependencies [d672e23]
- Updated dependencies [8f76786]
- Updated dependencies [ca27413]
- Updated dependencies [e68c576]
- Updated dependencies [6f9174c]
- Updated dependencies [579dbca]
  - @foreverworks/mcp-kit@0.4.0

## 0.1.3

### Patch Changes

- c132159: The server's instructions, which your client hands the model at the start of every session, are about half as long, so every session costs less. They now say what the server reaches, the tool to start with, the flows that run across tools, and what the model must know before its first call (what spends money, sends, publishes or acts on something in a home, and what to do when a sign-in is needed). What a tool's own description already says is left to it. Nothing a tool does changes.
  
  porkbun: the vendor's paragraph on publishing a site is now one sentence, and `deploy_site`'s description carries its checks, adding that `list_hosting_files` shows what is already there before an upload replaces it.
- Updated dependencies [75ea94a]
- Updated dependencies [0834240]
- Updated dependencies [64969a3]
- Updated dependencies [4ef1bf8]
- Updated dependencies [7b93f2f]
- Updated dependencies [27f0094]
  - @foreverworks/mcp-kit@0.3.0

## 0.1.2

### Patch Changes

- ad0d6fc: No change to the server. This version is the first published by the repository's release workflow through npm's trusted publishing, with no npm token anywhere; `npm view` names GitHub Actions as its publisher.

## 0.1.1

### Patch Changes

- Updated dependencies [2447a0d]
- Updated dependencies [db52a0b]
  - @foreverworks/mcp-kit@0.2.0

## 0.1.0

The first release. What people say about your app in both stores: App Store and Google Play reviews with the reply you gave each, and TestFlight feedback, with the crash log behind a crash report. It reads App Store Connect with a team API key and Google Play with a service account, both from files.

Its `write` tools publish a reply to a review, in your name and in public: `reply_app_store_review` and `reply_play_review`. Neither replaces a reply you already gave unless you ask it to. Nothing here moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
