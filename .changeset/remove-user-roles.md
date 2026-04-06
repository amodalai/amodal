---
"@amodalai/types": patch
"@amodalai/core": patch
"@amodalai/runtime": patch
"@amodalai/react": patch
---

Remove userId, userRoles, and userContext from the OSS runtime

The local runtime is single-tenant with no user system. Role-based access
control is now the responsibility of the hosting layer via the new
`onSessionBuild` hook on `CreateServerOptions`.

- Removed `userRoles` from FieldScrubber, OutputGuard, Session, AgentContext, ToolContext
- Removed `userContext` from AmodalConfig
- Removed `role` from chat request schema and React client
- Simplified `role_gated` policy to always deny (same as `never_retrieve`)
- Deleted PreferenceClient, ScopeChecker, user-context-fetcher
- Added `onSessionBuild` hook for hosting layer to enhance session components
