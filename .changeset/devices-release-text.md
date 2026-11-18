---
"@foreverworks/mcp-devices": patch
---

`release` tells the holder only what the broker's after-lease work does. A dirty release used to say "app data cleared, then stopped" for every Android slot with an adb address, even when no clear ran: a slot read through its unit (a guest's, whose door the broker cannot reach) keeps its tenant's data, and one released before it booted had none to clear. The text now comes from the work itself, so those say "stopped", a device with nothing to do says "left as it is", and a device released broken says what was done to it before "quarantined until someone checks it and clears it".
