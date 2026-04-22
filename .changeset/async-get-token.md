---
"@amodalai/react": patch
"@amodalai/runtime-app": patch
---

Support async getToken for token refresh before chat requests. Fixes intermittent 401 errors on SSE streams when cached tokens expire.
