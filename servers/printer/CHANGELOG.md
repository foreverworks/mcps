# @foreverworks/mcp-printer

## 0.1.0

The first release. One network printer and its flatbed scanner, over IPP Everywhere and eSCL: the device's state, paper and toner, printing a PDF or image as the printer's own lossless raster (corrected for its measured response once you calibrate it), and scanning what lies on the glass.

Its `write` tools act on paper in someone's home or on the calibration: `print`, `scan`, `cancel_job`, `calibration_sheet`, `measure_calibration` and `load_calibration`. Their descriptions ask that `print` and `scan` run only when you ask. Nothing here moves money: no tool is `money`.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
