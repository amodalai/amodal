---
"@amodalai/runtime": patch
---

Pass caller's auth token to bundleProvider so the hosted runtime can fetch deploy snapshots using the user's JWT instead of requiring a service API key.
