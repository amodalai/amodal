---
"@amodalai/runtime": patch
"@amodalai/core": patch
---

Extract platform-specific code from OSS runtime into injectable hooks.

**Breaking:** `createAuthMiddleware` and `AuditClient` are no longer exported from `@amodalai/runtime`. Auth middleware, audit logging, usage reporting, and session history persistence are now provided by the hosting layer via `CreateServerOptions.authMiddleware`, `streamHooks`, `additionalRouters`, and `onShutdown`.

**New exports:** `StreamHooks`, `SessionStore`, `StoredSessionRecord` interfaces for hosting layer integration.

**`@amodalai/core`:** `AgentSDK` constructor now accepts an optional third `platformClient` parameter for dependency injection.
