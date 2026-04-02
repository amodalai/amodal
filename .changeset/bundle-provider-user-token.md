---
"@amodalai/core": patch
"@amodalai/runtime": patch
---

Remove AgentSDK and platformApiUrl from SessionManager. The OSS runtime no longer makes platform API calls — the hosting layer delivers fully resolved bundles via bundleProvider. Simplify SessionStore interface to not require auth params. Unify chat routes onto createChatStreamRouter, removing the old agent/routes/chat.ts.
