# @foreverworks/mcp-home-assistant

## 0.1.0

The first release. Your Home Assistant from your AI assistant, over Home Assistant's own REST and WebSocket APIs with a long-lived access token: the instance's health, entities and their states, areas with their devices and entities, state history and the logbook over a window, the actions it offers with their fields, templates rendered by Home Assistant itself, and running actions.

Its `write` tools run actions: `call_action`, and `call_action_confirmed`, which you approve before every call. Actions on locks, alarm panels, covers and valves (or the domains `HOME_ASSISTANT_CONFIRM_DOMAINS` names) go only through `call_action_confirmed`. Nothing here moves money: no tool is `money`.

A token Home Assistant refuses is never sent again, because Home Assistant counts each refusal as a failed login and can ban the address.

It speaks MCP protocol revisions 2026-07-28 and 2025-11-25, over stdio and loopback HTTP, and lists the same tools to both.
