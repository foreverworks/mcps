# @foreverworks/mcp-eas

## 0.1.0

The first release. Expo Application Services through its GraphQL API: builds, workflow runs with each job's log and the reason a run failed, App Store Connect and Google Play submissions with the store's own error text, a credentials audit per bundle id and package, fingerprints, and EAS Update channels and rollouts.

Its one `money` tool is `dispatch_workflow`: its build jobs spend EAS build credits, so a client that honours the confirmation mark asks you before every call.

Its `write` tools change a project without spending credits: they cancel a build or a run, submit a build, set a submit key, republish an update, and raise or revert a rollout.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
