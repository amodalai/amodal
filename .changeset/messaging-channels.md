---
"@amodalai/types": patch
"@amodalai/core": patch
"@amodalai/runtime": patch
"@amodalai/amodal": patch
---

Add messaging channel plugin system

- Channel plugins are npm packages discovered via channel.json, dynamically loaded at boot
- Webhook router at POST /channels/:channelType/webhook with dedup, rate limiting, session affinity
- Drizzle and in-memory session mappers for channel user → session mapping
- ChannelPlugin interface with optional setup() for interactive CLI configuration
- `amodal connect channel <pkg>` and `amodal connect connection <pkg>` commands
- ChannelSetupContext for plugin-owned setup flows (prompt, writeEnv, updateConfig)
