---
"@foreverworks/mcp-app-stores": minor
---

`get_testflight_crash_log` now says why the app died, not just how the log begins. The answer picks out the exception and termination lines, Application Specific Information, the Last Exception Backtrace and the crashed thread's frames, from Apple's text format and from its JSON `.ips` format. Before, it showed the first 40 lines, which in a real report end long before the crashed thread, so a client that could not open the server's outbox could not diagnose anything. `from` and `count` read any other lines of the log.
