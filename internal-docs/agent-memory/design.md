# Agent Memory — Design Doc

## Status

Phase 1 shipped (single-row text blob, `update_memory` tool).
Phase 2 designed below — entry-level storage, session search, chat app UI.

## Context

Phase 1 stores memory as a single text blob that the agent overwrites entirely on each save. This works but has real problems:

- The LLM can accidentally drop entries when rewriting the whole blob
- No size limit — an aggressive agent grows memory until it eats the context window
- No mid-session visibility — memory loads once at session start
- No session search — the agent can't recall past conversations it didn't explicitly save
- No user visibility — users can't see or manage what the agent remembers

Hermes (NousResearch) ships a three-layer memory system that's driven a lot of their popularity. Their key ideas worth adopting: entry-level operations (not blob overwrite), session search via FTS, nudge/flush for proactive saving, and character budgets. See appendix for full comparison.

## Phase 2 Design

### Architecture: Direct Postgres via @amodalai/db

Memory follows the same data access pattern as stores, sessions, and feedback: direct Postgres via the shared `getDb()` singleton from `@amodalai/db`. Both the runtime and Studio read/write the same tables through Drizzle ORM.

```
┌──────────────────────┐    ┌──────────────────────┐
│ RUNTIME              │    │ STUDIO               │
│                      │    │                      │
│ memory tool ─────┐   │    │ memory UI ────────┐  │
│ session search ──┤   │    │ memory routes ────┤  │
│ prompt injection─┤   │    │                   │  │
└──────────────────┤───┘    └───────────────────┤──┘
                   │                            │
            ┌──────▼────────────────────────────▼──┐
            │ @amodalai/db  ·  getDb() singleton   │
            └──────────────────┬───────────────────┘
                               │
            ┌──────────────────▼───────────────────┐
            │            POSTGRES                   │
            │  agent_memory_entries (appId-scoped)  │
            │  agent_sessions (already exists)      │
            └──────────────────────────────────────┘
```

Tenant isolation uses `appId` WHERE clauses, same as stores. This has known limitations (no RLS, no schema-per-tenant) but matches the current model for all mutable data. When infra moves to DB-per-tenant (Neon branching or similar), memory comes along for free.

**Note:** The vercel-shaped architecture doc states "no shared databases — each service owns its storage and exposes HTTP APIs." The current codebase doesn't follow this yet for anything (stores, sessions, feedback all use shared DB). Memory follows the pattern that exists today. When the codebase migrates to API-based data access, memory migrates with it.

**Known architectural debt:** The shared-DB model with application-level `appId` filtering has no defense in depth — a missing WHERE clause leaks data across tenants. There is no Postgres RLS, no schema-per-tenant, no DB-per-tenant. This is a problem for all mutable data (stores, sessions, feedback, memory), not just memory. It needs to be addressed before scaling to multi-tenant cloud with untrusted tenants. Options: Postgres RLS policies on `app_id`, Neon database branching (DB-per-tenant with scale-to-zero), or migrating to the intended API-based architecture where each service owns its storage. This is a cross-cutting infrastructure decision that should be made once for all data, not piecemeal per feature.

### Storage: Entry-per-row

Replace the single-row `agent_memory` table with `agent_memory_entries`:

```sql
CREATE TABLE agent_memory_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id     TEXT NOT NULL,
  content    TEXT NOT NULL,
  category   TEXT,              -- 'preference', 'fact', 'correction', or NULL
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memory_app ON agent_memory_entries (app_id);
CREATE INDEX idx_memory_search ON agent_memory_entries
  USING GIN (to_tsvector('english', content));
```

Scoped by `app_id` — same column name and semantics as `store_documents.app_id`.

### Memory Tool

Replace `update_memory` with a `memory` tool supporting granular operations:

```typescript
const MemoryParamsSchema = z.object({
  action: z.enum(["add", "remove", "list", "search"]),
  content: z.string().optional(), // required for 'add'
  entry_id: z.string().optional(), // required for 'remove'
  query: z.string().optional(), // required for 'search'
});
```

**Actions:**

- `add` — insert a new entry. Rejects if total entries exceed budget. Returns the new entry with its ID.
- `remove` — delete an entry by ID. The agent gets IDs from `list` or `search`.
- `list` — return all entries as a numbered list with IDs. Powers "tell me my memories."
- `search` — full-text search across entries via `to_tsquery`. Returns matching entries with snippets.

The tool uses the DB handle from `SharedResources` (same as store tools use `storeBackend`). Implemented as a Drizzle query layer in `packages/runtime/src/tools/memory-tool.ts`, replacing the current single-row implementation.

**Budget enforcement:** configurable `maxEntries` (default 50) and `maxTotalChars` (default 8,000). The `add` action checks current count and total size before inserting. On exceed, returns a structured error telling the agent to remove stale entries first.

### Session Search

Add a `search_sessions` tool that searches past conversation history:

```typescript
const SessionSearchParamsSchema = z.object({
  query: z.string(),
  max_results: z.number().int().min(1).max(20).optional(),
});
```

Implementation: Postgres full-text search against the `agent_sessions` table's message content. The sessions table already exists with full message history. Add a GIN index on message content for FTS:

```sql
-- on the messages JSONB column, extract text content for search
CREATE INDEX idx_sessions_messages_fts ON agent_sessions
  USING GIN (to_tsvector('english', messages::text));
```

Returns: matching snippets with 1 message of surrounding context, session timestamp, session ID. Scoped by `app_id`.

This is the "wow" feature — "remember that API migration we discussed last week?" works because the agent can search all past conversations, not just what it explicitly saved to memory.

### System Prompt Injection

At session start, load all entries via `SELECT * FROM agent_memory_entries WHERE app_id = $1 ORDER BY created_at` and inject into the system prompt:

```
## Memory

1. User is a dentist, does not work on Fridays [id: abc123]
2. User prefers dark mode [id: def456]
3. Project uses PostgreSQL 16 on Railway [id: ghi789]
```

IDs are included so the agent can reference them in `remove` calls.

### Mid-Session Visibility

The system prompt memory section is frozen at session start (good for prefix caching). But when the agent calls `memory.add` or `memory.remove` mid-session, the tool response includes the full updated entry list. The LLM sees this in the conversation context and can use new facts immediately.

This means: if a user says "I don't work on Fridays" and the agent saves it, the agent knows that fact for the rest of the session (from the tool response) AND for all future sessions (from the prompt injection). No system prompt mutation needed.

### Nudge System (Proactive Saving)

Every N turns (configurable via `nudgeInterval`, default 10), inject a lightweight system message:

> "Check: has the user shared any preferences, corrections, or important facts in recent messages? If so, save them to memory."

Also: **flush before context loss** — when `budget_exceeded` is about to terminate the loop, give the agent one final turn to save anything important from the session.

This normalizes save behavior across models. Some models proactively call `memory.add`; others don't unless prompted.

### Chat App UI

Memory is surfaced in the chat app (runtime-app) as a first-class panel, same level as Sessions in the sidebar.

**User-facing features:**

- **List view** — all memory entries with timestamps, edit/delete buttons
- **Inline edit** — click to edit any entry directly
- **Delete** — single entry or bulk delete
- **Search** — filter entries by keyword

**Conversational management (via the agent):**

- "Tell me my memories" → agent calls `memory.list`
- "Delete memory about dark mode" → agent calls `memory.search` then `memory.remove`
- "Remember that I prefer TypeScript" → agent calls `memory.add`

The UI reads/writes the same Postgres table directly (through the runtime's existing API routes or new `/api/memory` routes). No separate backend needed.

### Agent Instructions

```
## Memory Instructions

You have persistent memory. Entries appear in your context under "Memory."

**When to save:**
- User states a preference ("I prefer...", "I like...", "Don't...")
- User corrects you ("No, actually...", "That's wrong...")
- User shares a fact about themselves or their project
- You discover something important through tool use

**How to save:**
- Write declarative facts: "User is a dentist" not "Always ask about dental practice"
- One fact per entry — don't bundle unrelated things
- Keep entries concise — 1-2 sentences max

**When to remove:**
- User explicitly asks to forget something
- A new fact contradicts an existing entry — remove the old one, add the new one

**When to search sessions:**
- User references a past conversation ("remember when we...", "last time...")
- You need context from prior work to answer accurately
```

### Config

```json
{
  "memory": {
    "enabled": true,
    "editableBy": "any",
    "maxEntries": 50,
    "maxTotalChars": 8000,
    "nudgeInterval": 10,
    "sessionSearch": true
  }
}
```

### Migration Path from Phase 1

1. Add `agent_memory_entries` table to `@amodalai/db` schema and migration
2. Migrate existing single-row blobs: split by sentence/paragraph into entries
3. Replace `update_memory` tool with multi-action `memory` tool
4. Add `search_sessions` tool
5. Add memory routes to runtime for the UI
6. Add UI panel to runtime-app
7. Drop old `agent_memory` table

### Open Questions

1. **Per-user memory** — currently scoped by `appId` (per-agent-instance). Multi-user agents need per-user scoping, which requires threading user ID from the auth middleware through to the tool context. New plumbing — defer until multi-user is a real requirement.
2. **Categories** — optional entry categories (preference, fact, correction) are useful for UI filtering but add complexity to the tool schema. Leaning yes but not blocking.
3. **Rate limiting** — should we cap writes per session to prevent runaway save loops? Probably yes (e.g., max 10 writes per session).

## Appendix: Hermes Comparison

| Aspect             | Amodal Phase 2                                 | Hermes                                                |
| ------------------ | ---------------------------------------------- | ----------------------------------------------------- |
| Storage            | Entry-per-row in Postgres                      | Two flat files (MEMORY.md, USER.md) with § delimiters |
| Operations         | add / remove / list / search                   | add / replace / remove (substring matching)           |
| Size control       | maxEntries + maxTotalChars                     | Per-file character budgets (2,200 / 1,375)            |
| Prompt injection   | Frozen snapshot at session start               | Same — frozen snapshot                                |
| Mid-session        | Updated entry list in tool response            | Same — tool response shows live state                 |
| Proactive saving   | Nudge every N turns + flush on budget_exceeded | Nudge every N turns + flush on /new, /reset, exit     |
| Session search     | Postgres FTS on existing sessions table        | SQLite FTS5 on messages table                         |
| User management    | Chat app UI + conversational via agent         | CLI only                                              |
| Tenant isolation   | appId WHERE clause (same as stores)            | Single-user (file-based)                              |
| External providers | None (MCP for that)                            | Plugin system (Honcho, Mem0, etc.)                    |

Key things we skip: two-file split (over-engineered), external provider plugins (we have MCP), content injection scanning (later concern).
