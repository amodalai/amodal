---
"@amodalai/amodal": patch
---

Generate skeleton .env on init, remove apiKey from scaffolded amodal.json

`amodal init` now creates a `.env` file with commented provider keys (selected provider uncommented) and a DATABASE_URL placeholder. The scaffolded `amodal.json` no longer includes an `apiKey` field — the runtime auto-detects from env vars.
