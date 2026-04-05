---
"@amodalai/runtime": patch
"@amodalai/core": patch
---

Restore admin file-discovery tools that went missing after the SDK swap.

The admin agent had `read_repo_file`, `write_repo_file`, `delete_repo_file`
and `internal_api` but no way to **enumerate** what files exist — it spent
turns guessing paths (`skills/content-analysis/SKILL.md`, `agents/main.md`)
and often failing. This adds five new admin file tools, all sharing the
same allowed-directory allowlist:

- `list_repo_files` — list files in an allowed directory (or every
  allowlist dir at once). Recursive by default. Skips `.git`,
  `node_modules`, `.DS_Store`. Capped at 2000 entries with a
  `truncated: true` signal.
- `glob_repo_files` — glob pattern match (`**/SKILL.md`, `skills/**/*.md`)
  with recent-first sort (24h-touched files surfaced first). Capped at 500.
- `grep_repo_files` — regex content search across the allowlist. Optional
  `dir` filter, `include` glob, case-insensitivity default. Capped at 100
  matches (matches gemini-cli's `DEFAULT_TOTAL_MAX_MATCHES`).
- `edit_repo_file` — find-and-replace edit in place. Default requires
  exactly-one-occurrence (fails safely on ambiguous edits); set
  `allow_multiple: true` to replace every match. Saves context tokens
  vs full-rewrite `write_repo_file`.
- `read_many_repo_files` — batched read of multiple files. Capped at
  20 files × 50KB each.

Also fixes the confusing `Path "skills" is not in an allowed directory`
error from `read_repo_file`/`write_repo_file`/`delete_repo_file` when
passed a bare allowlist directory name — they now emit a directed error
pointing at `list_repo_files`:

    Path "skills" is a directory — use list_repo_files to enumerate its
    contents, or provide a file path like "skills/<name>".

**Dead code removed:**

- `packages/runtime/src/session/admin-file-tools.ts` (superseded by
  `packages/runtime/src/tools/admin-file-tools.ts` in the SDK swap,
  never deleted, zero imports).
- `packages/core/src/tools/definitions/amodal-tools.ts` plus
  `getProposeKnowledgeDefinition`/`getPresentToolDefinition`/
  `getRequestToolDefinition` exports from `@amodalai/core` — the
  underlying `propose_knowledge` tool was deleted in #144, leaving
  these as stale definitions for a non-existent tool.
