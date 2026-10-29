---
"@foreverworks/mcp-kit": minor
---

`run` starts a program with no shell, a deadline and capped output, for a server that drives a command-line tool. The program leads a process group of its own and the deadline kills the whole group, so a tool's own children (ocrmypdf's tesseract, ssh's proxy command) cannot keep the call waiting past it. `truncated` says when output went past the cap and was cut, and a program killed by a signal other than the deadline's answers 128 plus the signal's number.
