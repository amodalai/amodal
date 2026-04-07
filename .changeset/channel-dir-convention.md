---
"@amodalai/core": patch
---

Update channel resolver to scan channels/<name>/channel.json

Matches the connection package convention where metadata lives under
connections/<name>/. Allows a single package to contain multiple channels.
