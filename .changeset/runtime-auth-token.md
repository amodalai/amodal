---
"@amodalai/runtime": patch
---

Add AUTH_TOKEN env var for simple bearer token auth. When set, chat and session endpoints require `Authorization: Bearer {token}`. When not set, no auth (local dev). Hosting layers that inject their own auth middleware override this.
