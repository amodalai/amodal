---
"@amodalai/runtime-app": patch
---

Gate all data hooks on token availability. Local dev returns 'local' as token. Queries use token from context, mutations use getToken() with auth check. Auto-refresh on expiry.
