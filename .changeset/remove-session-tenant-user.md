---
"@amodalai/runtime": patch
---

Remove `tenantId` and `userId` from sessions, tool context, and session store.

Both fields were vestigial — carried through every layer but never used
for any authorization, scoping, or product decision. Default values
were hard-coded placeholders (`'local'`, `'admin'`, `'snapshot'`,
`'automation'`, `'api'`, `'anonymous'`) that had no relationship to
real identities.

Consumers needing tenant or user scoping should:

- Namespace session IDs directly (e.g. `tenant-a:session-123`)
- Stamp scope into `metadata` JSONB and filter via `list({filter})`
- Use `userRoles` (still present, still drives connection ACLs)

**API changes:**

- `Agent.createSession()` no longer accepts `tenantId` / `userId` options
- `ToolContext` drops `tenantId` field — tools reading `ctx.tenantId`
  must be updated
- `PersistedSession`, `Session`, `CreateSessionOptions` all drop both
  fields
- `SessionStore.load(sessionId)` — was `load(tenantId, sessionId)`
- `SessionStore.delete(sessionId)` — was `delete(tenantId, sessionId)`
- `SessionStore.list(opts)` — was `list(tenantId, opts)`
- `StandaloneSessionManager.listPersisted(opts)` — was
  `listPersisted(tenantId, opts)`
- `AuthContext` drops unused `orgId` and `actor` fields

**Schema change:**

- `agent_sessions` table drops `tenant_id` and `user_id` columns
- Index `idx_agent_sessions_tenant` replaced with
  `idx_agent_sessions_updated`
- **Existing deployments must drop these columns** before running this
  version, or roll back persisted sessions. The columns are no longer
  written to or read from.
