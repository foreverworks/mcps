# Privacy: the app you make with setup

`npx -y @foreverworks/mcp-google setup` has you create an OAuth app in a
Google Cloud project of your own, and Google asks that app for a privacy
policy link before it can be published. This page is that policy, for anyone
who points their app at it. It describes the Google Workspace MCP server in
this folder, which is what the app runs.

**Who runs it.** You do. The app is a copy of this open-source server running
on your own computer, or on a machine you control. Its authors run no service
for it and never see your app, your accounts or your data.

**What it reads and changes.** Only what your AI assistant asks for, through
the server's tools, in the Google products you approved: mail, calendars,
Drive files, Docs, Sheets, Slides, tasks, contacts and Meet records. Each
product's access is a separate grant you approve in Google's own consent
screen. The server's [README](README.md) lists every tool and what it can
change.

**Where your data goes.** To Google's APIs, and to the AI assistant you
connected the server to, which shows it to its model as that assistant's own
terms describe. Nowhere else: the server sends no telemetry and keeps no copy
on anyone else's machine.

**What it keeps.** The grants (refresh tokens), short-lived access tokens, and
the files you ask it to download, in a folder on your computer readable only
by you (`~/.local/state/mcps/google`, or `%APPDATA%\mcps\google` on Windows,
unless you configured another).

**How to stop it.** Remove the server from your assistant and delete that
folder. To revoke the grants at Google as well, open
[your Google Account's third-party access page](https://myaccount.google.com/connections)
and remove the app.
