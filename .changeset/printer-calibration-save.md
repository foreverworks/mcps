---
"@foreverworks/mcp-printer": minor
---

`calibration` takes an optional `save`. With `save: true` it also writes the calibration file to the outbox, byte for byte as the server stores it, and answers `saved` with the file's `path`, `sha256` and `size`, next to the summary it always gave. That file is exactly what `load_calibration` accepts, so a calibration moves to a new machine by calling `calibration` with `save: true` on the old server and `load_calibration` with the file on the new one; the new server then reports the same patches and sheets. Without `save` nothing changes and nothing is written, and with `save` while no calibration is loaded the call answers an `input` error instead of an empty file. `calibration` stays `read`, as the other tools that only save a file to the outbox are.

The container image has a `printer` build that includes poppler (`pdfinfo`, `pdftoppm`) and the fonts it falls back on, published as `ghcr.io/foreverworks/mcps:<full sha>-printer`; the README and `docs/deploying.md` say what it adds.
