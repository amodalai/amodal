# Agent Memory — Design Doc

## Status

Phase 1 shipped (single-row text blob, `update_memory` tool).
Phase 2 designed below — entry-level storage, session search, Studio API, chat app UI.

## Context

Phase 1 stores memory as a single text blob that the agent overwrites entirely on each save. This works but has real problems:

- The LLM can accidentally drop entries when rewriting the whole blob
- No size limit — an aggressive agent grows memory until it eats the context window
- No mid-session visibility — memory loads once at session start
- No session search — the agent can't recall past conversations it didn't explicitly save
- No user visibility — users can't see or manage what the agent remembers

Hermes (NousResearch) ships a three-layer memory system that's driven a lot of their popularity. Their key ideas: entry-level operations, session search via FTS, frozen prompt snapshots, nudge/flush for proactive saving, and user-facing memory management. We don't need all of it, but we need the core pieces.

## Phase 2 Design

### Storage: Entry-per-row

Replace the single-row `agent_memory` table with an `agent_memory_entries` table:

```sql
CREATE TABLE agent_memory_entries (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id   TEXT NOT NULL,
  content    TEXT NOT NULL,
  category   TEXT,                          -- optional: 'preference', 'fact', 'correction'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memory_agent ON agent_memory_entries (agent_id);
CREATE INDEX idx_memory_search ON agent_memory_entries
  USING GIN (to_tsvector('english', content));
```

This table lives in **Studio's Postgres**, not the runtime DB. Memory is mutable user data that must persist across deploys — same category as sessions, stores, feedback.

### Architecture: Studio API, not direct DB

The runtime does NOT connect to the memory DB directly. Instead:

```
[Runtime] --HTTP--> [Studio API] --SQL--> [Postgres]
    |                    |
    |                    +-- /api/studio/memory (CRUD + search)
    |
    +-- memory tool (thin HTTP client, like web_search tool)
```

**Why API instead of direct DB:**

- Runtime stays stateless — no DB credentials needed
- Chat app UI hits the same endpoints for the memory panel
- Clean module boundary — Studio owns the schema, runtime just calls
- Third-party deployments can swap in their own memory backend
- Same pattern as `web_search` tool (ctx.searchProvider) and `request` tool (ctx.request)

### Studio API Endpoints

```
GET    /api/studio/memory?agentId=X              -- list all entries
POST   /api/studio/memory                        -- add entry
PATCH  /api/studio/memory/:id                    -- update entry
DELETE /api/studio/memory/:id                    -- delete entry
GET    /api/studio/memory/search?q=X&agentId=X   -- full-text search
```

All endpoints return JSON. The list endpoint returns entries with IDs so the UI and agent can reference them.

### Memory Tool (Runtime)

Replace the single `update_memory` tool with a `memory` tool that supports multiple actions:

```typescript
const MemoryParamsSchema = z.object({
  action: z.enum(["add", "remove", "list", "search"]),
  content: z.string().optional(), // required for 'add'
  entry_id: z.string().optional(), // required for 'remove'
  query: z.string().optional(), // required for 'search'
});
```

**Actions:**

- `add` — saves a new entry. Rejects if total entries exceed budget (configurable, default ~20 entries or ~4,000 chars total). Returns the new entry with its ID.
- `remove` — deletes an entry by ID. The agent gets IDs from `list` or `search`.
- `list` — returns all entries as a numbered list with IDs. This is what powers "tell me my memories."
- `search` — full-text search across entries. Returns matching entries with snippets.

The tool is a thin HTTP client that calls the Studio API. It's wired via a `MemoryClient` injected through the tool context, same pattern as `SearchProvider` for web search.

### Session Search

Add a `search_sessions` tool that searches across past conversation history:

```typescript
const SessionSearchParamsSchema = z.object({
  query: z.string(),
  max_results: z.number().int().min(1).max(20).optional(),
});
```

This hits a Studio API endpoint:

```
GET /api/studio/sessions/search?q=X&agentId=X
```

Studio runs `ts_query` against the session messages table (which already exists). Returns snippets with 1 message of surrounding context, session timestamps, and session IDs.

This is the "wow" feature — "remember that API migration we discussed last week?" actually works.

### System Prompt Injection

At session start, the runtime calls `GET /api/studio/memory?agentId=X` and injects all entries into the system prompt as a numbered list:

```
## Memory

1. User is a dentist, does not work on Fridays [id: abc123]
2. User prefers dark mode [id: def456]
3. Project uses PostgreSQL 16 on Railway [id: ghi789]
```

IDs are included so the agent can reference them in `remove` calls.

### Mid-Session Visibility

When the agent calls `memory.add` or `memory.remove`, the tool response includes the updated entry list. The LLM sees this in the conversation context and can use the new facts immediately — no need to mutate the system prompt mid-session.

This matches Hermes's "frozen snapshot" approach: the system prompt section stays stable (good for prefix caching), but the agent has full awareness of changes through tool responses.

### Nudge System (Proactive Saving)

Every N turns (configurable, default 10), inject a lightweight system message:

> "Check: has the user shared any preferences, corrections, or important facts in recent messages? If so, save them to memory using the memory tool."

This normalizes save behavior across models. Some models are proactive about memory; some aren't. The nudge makes it consistent.

Also add a **flush on context loss**: before `budget_exceeded` terminates the loop, give the agent one turn to save anything important.

### Chat App UI (runtime-app)

Add a "Memory" panel accessible from the sidebar, same level as "Sessions":

- **List view** — shows all memory entries with timestamps, edit/delete buttons
- **Add** — manual entry form
- **Edit** — inline editing of any entry
- **Delete** — single entry or bulk delete
- **Search** — search bar that filters entries

All operations hit the Studio API directly from the frontend. No agent involved for manual management.

The agent can also manage memory conversationally:

- "Tell me my memories" → agent calls `memory.list`, renders as a numbered list
- "Delete memory 3" → agent calls `memory.remove` with the entry ID
- "Remember that I prefer TypeScript over JavaScript" → agent calls `memory.add`

### Agent Instructions

System prompt guidance for memory behavior:

```
## Memory Instructions

You have persistent memory for this user. Entries appear in your context under "Memory."

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
- You learn a fact that contradicts an existing entry — remove the old one, add the new one

**When to search sessions:**
- User references a past conversation ("remember when we...", "last time...")
- You need context from prior work to answer accurately
```

### Migration Path from Phase 1

1. Add the `agent_memory_entries` table to Studio's DB
2. Migrate existing single-row blobs: split by newline/paragraph into entries
3. Add Studio API endpoints
4. Replace the runtime `update_memory` tool with the new `memory` tool
5. Add `search_sessions` tool
6. Add UI panel
7. Drop the old `agent_memory` table

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

### Open Questions

1. **Categories** — should entries have optional categories (preference, fact, correction)? Useful for filtering in the UI but adds complexity to the tool schema. Leaning yes.
2. **Per-user vs per-agent** — in multi-user scenarios, should memory be scoped per user? Currently it's per-agent-instance (per database). Multi-user scoping needs a user ID column.
3. **Rate limiting** — should we limit how often the agent can write to memory per session? Prevents runaway saving loops.
