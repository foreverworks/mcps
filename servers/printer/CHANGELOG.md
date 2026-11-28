# @foreverworks/mcp-printer

## 0.2.0

### Minor Changes

- 80d64d0: `calibration` takes an optional `save`. With `save: true` it also writes the calibration file to the outbox, byte for byte as the server stores it, and answers `saved` with the file's `path`, `sha256` and `size`, next to the summary it always gave. That file is exactly what `load_calibration` accepts, so a calibration moves to a new machine by calling `calibration` with `save: true` on the old server and `load_calibration` with the file on the new one; the new server then reports the same patches and sheets. Without `save` nothing changes and nothing is written, and with `save` while no calibration is loaded the call answers an `input` error instead of an empty file. `calibration` stays `read`, as the other tools that only save a file to the outbox are.
  
  The container image has a `printer` build that includes poppler (`pdfinfo`, `pdftoppm`) and the fonts it falls back on, published as `ghcr.io/foreverworks/mcps:<full sha>-printer`; the README and `docs/deploying.md` say what it adds.

### Patch Changes

- Updated dependencies [d672e23]
- Updated dependencies [8f76786]
- Updated dependencies [ca27413]
- Updated dependencies [e68c576]
- Updated dependencies [6f9174c]
- Updated dependencies [579dbca]
  - @foreverworks/mcp-kit@0.4.0

## 0.1.2

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

## 0.1.1

### Patch Changes

- Updated dependencies [2447a0d]
- Updated dependencies [db52a0b]
  - @foreverworks/mcp-kit@0.2.0

## 0.1.0

The first release. One network printer and its flatbed scanner, over IPP Everywhere and eSCL: the device's state, paper and toner, printing a PDF or image as the printer's own lossless raster (corrected for its measured response once you calibrate it), and scanning what lies on the glass.

Its `write` tools act on paper in someone's home or on the calibration: `print`, `scan`, `cancel_job`, `calibration_sheet`, `measure_calibration` and `load_calibration`. Their descriptions ask that `print` and `scan` run only when you ask. Nothing here moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
