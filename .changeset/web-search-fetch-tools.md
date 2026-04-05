---
"@amodalai/runtime": patch
"@amodalai/core": patch
"@amodalai/types": patch
---

Add built-in `web_search` and `fetch_url` tools backed by Gemini Flash
grounding. Enabled when `webTools` is configured in `amodal.json` with
a Google API key:

```json
{
  "webTools": {
    "provider": "google",
    "apiKey": "env:GOOGLE_API_KEY",
    "model": "gemini-3-flash-preview"
  }
}
```

`web_search` returns a synthesized answer with cited source URLs.
`fetch_url` returns page content as markdown — Gemini `urlContext` is
the primary path, with a local `fetch()` + Mozilla Readability fallback
for private-network URLs (localhost, RFC1918) or Gemini failures. Both
tools are registered automatically on every session when `webTools` is
present. Per-hostname rate limiting (10 req / 60s) and a 2000-token
cap apply to both tools.
