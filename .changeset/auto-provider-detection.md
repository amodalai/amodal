---
"@amodalai/types": patch
"@amodalai/core": patch
"@amodalai/runtime": patch
"@amodalai/amodal": patch
---

Make models config optional — auto-detect provider from environment API keys

When `models` is omitted from amodal.json, the runtime detects which provider to use based on
available API keys in the environment. Preference order: Google (gemini-2.5-flash) → Anthropic →
OpenAI → DeepSeek → Groq → Mistral → xAI.

Also fixes admin agent spawning for npm-published packages that use package.json instead of amodal.json.
