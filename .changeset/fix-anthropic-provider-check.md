---
"@amodalai/runtime": patch
---

Fix Anthropic provider-key verification at `amodal dev` startup.
The check was hitting `GET /v1/messages`, which Anthropic rejects
with HTTP 405 (Method Not Allowed) before it even looks at the
`x-api-key` header — so every key, valid or bogus, showed up as
`provider_key_invalid`. Switch to `GET /v1/models`, which returns
200 on valid keys and 401 on bad ones.
