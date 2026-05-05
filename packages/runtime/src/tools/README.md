<!--
Copyright 2026 Amodal Labs, Inc.
SPDX-License-Identifier: MIT
-->

# Custom-tool SDK

Public API for tools shipped inside agent packages — `agent-admin`,
`connection-*`, `template-*`, and any third-party agent the registry
points to. Every tool that wants to do more than return a string
(emit inline UI, read or write files, run a query, make an HTTP call)
goes through this surface.

The SDK is maintained as **additive-only** post-launch. Existing
fields and block types do not change shape — older tools keep working
when the runtime upgrades, and the registry doesn't have to track
per-package SDK versions.

## Where tools live

```
<agent-package>/
  package.json              ← amodal.permissions declares capabilities
  tools/
    my_tool/
      tool.json             ← description + JSON Schema parameters
      handler.ts            ← export default async (params, ctx) => …
```

The runtime walks `<agent-package>/tools/*/{tool.json, handler.ts}`
on agent load. Every directory whose name matches `^[a-z][a-z0-9_]*$`
becomes a tool the LLM can call. There is no separate registration
step.

## Writing a handler

```ts
// tools/show_preview/handler.ts
import type { ToolContext } from "@amodalai/runtime/tools";

export default async function showPreview(
  params: { title: string; tagline: string },
  ctx: ToolContext,
): Promise<{ ok: true }> {
  ctx.emit({
    type: "block",
    block: {
      type: "agent_card_preview",
      card: {
        title: params.title,
        tagline: params.tagline,
        platforms: [],
        thumbnailConversation: [],
      },
    },
  });
  return { ok: true };
}
```

The first argument is the parameter object (validated against
`tool.json#parameters` before the handler runs). The second is a
[`ToolContext`](./context.ts) — the SDK surface this README documents.

Pure-JS handlers work too — agent packages with no build step can ship
a plain function and skip the `@amodalai/runtime` import. The runtime
compiles `handler.ts` with esbuild on first call regardless.

## `ToolContext` reference

```ts
interface ToolContext {
  // Identity
  agentId: string;
  scopeId: string; // empty string = agent-level
  scopeContext?: Record<string, string>;
  sessionId: string;

  // Side effects (always available)
  emit(event: EmitEvent): void; // structured: text | block | error
  log(message: string): void; // sugar for emit({type:'text', …})

  // Capabilities (permission-gated)
  fs: FsBackend;
  db: ToolDbHandle;
  fetch: typeof globalThis.fetch;

  // Cancellation
  signal: AbortSignal;
}
```

### `ctx.emit(event)`

Three event variants:

- `{type: 'text', text}` — appended as agent prose alongside the LLM's stream.
- `{type: 'block', block}` — dispatched into the inline-block list and rendered
  by the widget (or by Studio's `inlineBlockRenderers` for Studio-only block
  types like `connection_panel`).
- `{type: 'error', message}` — surfaces an inline error notice and is logged
  server-side.

Block types are typed in [`@amodalai/types/blocks`](../../../types/src/blocks.ts)
as a discriminated union — `text`, `ask_choice`, `agent_card_preview`,
`connection_panel`, `proposal`, `update_plan`. Add a new variant by
extending the union; the widget reducer keys off the `type` field.

### `ctx.fs` — repo file access

```ts
ctx.fs.readRepoFile("amodal.json");
ctx.fs.writeRepoFile("skills/digest/SKILL.md", body);
ctx.fs.readManyRepoFiles(["a.json", "b.json"]);
ctx.fs.listRepoFiles("skills/");
ctx.fs.deleteRepoFile("skills/old-skill/SKILL.md");
```

All paths are repo-relative. Absolute paths and `..` traversal are
rejected — the backend throws `FsSandboxError`. The same handler
works against either backend the runtime selects via
`AMODAL_REPO_MODE`:

- `local` (default, `amodal dev`) — direct `fs/promises`, sub-ms.
- `cloud` — proxies through `cloud-phase-4/platform-api`'s
  `/api/repo/files/*` routes (Phase 0G); ~20-50ms per write.

Permission gates: `readRepoFile` / `readManyRepoFiles` / `listRepoFiles`
require `fs.read`. `writeRepoFile` / `deleteRepoFile` require `fs.write`.

### `ctx.db` — Drizzle handle

```ts
const rows = await ctx.db.execute({
  sql: "SELECT * FROM setup_state WHERE agent_id = $1",
  params: [ctx.agentId],
});
```

Scoped to the agent's session. Phase B introduces per-domain query
modules at `@amodalai/db/queries/<domain>.ts` (the Midday pattern); use
those over raw SQL when one exists.

Permission gate: any call to `ctx.db.execute` requires both `db.read`
and `db.write` — the SDK can't reliably parse SQL to know which is
which, so the conservative gate is "declare both if you touch the DB
at all." Phase B may split into `query()` / `mutate()` once we see how
db tools shake out in practice.

### `ctx.fetch` — outbound HTTP

Same signature as `globalThis.fetch`. The runtime injects `ctx.signal`
when the caller doesn't pass one, so outbound requests cancel with the
tool invocation.

Permission gate: `net.fetch`.

## Declaring permissions

In the agent package's `package.json`:

```json
{
  "name": "@amodalai/agent-admin",
  "amodal": {
    "permissions": ["fs.read", "fs.write", "db.read", "db.write"]
  }
}
```

Default-deny: a package with no `amodal.permissions` block gets an
empty list, and any tool inside it that reaches for a privileged
`ctx.*` capability throws `PermissionError` at the boundary, naming
the tool, the missing permission, and the package.

Available tiers:

- `fs.read` / `fs.write` — repo file access.
- `db.read` / `db.write` — Drizzle `ctx.db.execute`.
- `net.fetch` — outbound HTTP.

Notably **not present**: `secrets.*`. Credentials enter the system in
exactly two places — the Configure modal (`POST /api/secrets/:name`)
and the OAuth callback (`/api/oauth/callback`). The SDK has no
`ctx.saveSecret` and never will. Tools never see tokens in args, in
chat history, or in the LLM's context window. If your tool needs a
secret to talk to a third party, read it from `process.env` at runtime
through the connection package's auth surface — never accept it as a
parameter from the LLM.

## Common patterns

### Emit a block from a handler

```ts
ctx.emit({
  type: "block",
  block: {
    type: "ask_choice",
    askId: `choice_${ctx.sessionId}_${Date.now().toString(36)}`,
    question: "When should the digest run?",
    options: [
      { label: "Monday 8 AM", value: "monday-8am" },
      { label: "Friday 4 PM", value: "friday-4pm" },
    ],
  },
});
```

### Read setup state from the DB (Phase B onward)

```ts
const rows = await ctx.db.execute({
  sql: "SELECT * FROM setup_state WHERE agent_id = $1 AND scope_id = $2",
  params: [ctx.agentId, ctx.scopeId],
});
```

### Write a config file

```ts
await ctx.fs.writeRepoFile(
  "amodal.json",
  JSON.stringify({ ...config, packages: [...config.packages, name] }, null, 2) +
    "\n",
);
```

### Make an outbound HTTP call

```ts
const res = await ctx.fetch("https://api.example.com/probe", {
  headers: { Authorization: `Bearer ${process.env.MY_TOKEN}` },
});
const data = (await res.json()) as { count: number };
```

## Errors

- `PermissionError` — a `ctx.*` method was called without the matching
  permission declared. Message names tool / package / permission so
  the package author can fix the manifest in one place.
- `FsSandboxError` — a path resolved outside the repo root. Callers
  should treat this as a bug, not a recoverable failure.

Both extend `Error` and are exported from `@amodalai/runtime/tools`.

## Versioning

The SDK ships in `@amodalai/runtime`. Subpath import:

```ts
import type { ToolContext } from "@amodalai/runtime/tools";
import {
  PermissionError,
  FsSandboxError,
  LocalFsBackend,
} from "@amodalai/runtime/tools";
```

Treat the block-type union and the `ToolContext` interface as
**additive-only**. New phases extend; they do not rename or remove.

## Related

- **Connection validation probes** (Phase A) — the contract a connection
  package's `validate.js` follows so the admin agent's
  `validate_connection` tool can surface a real-data sanity check after
  Connect. Documented in
  [`@amodalai/core/cards/README.md`](../../../core/src/cards/README.md#connection-validation-probes).
