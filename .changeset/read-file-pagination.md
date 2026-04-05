---
"@amodalai/runtime": patch
---

Add line-range pagination to `read_repo_file` so long files don't blow the
agent's context window on a single call.

Matches the conventions of Claude Code's `Read` tool and gemini-cli's
`read_file`: by default a read returns the first 2000 lines and tells the
agent how many more there are, so the agent can paginate only when it
actually needs the rest.

**New parameters on `read_repo_file`:**

- `offset` (1-indexed, default `1`) — the line number to start reading from
- `limit` (default 2000, max 10000) — how many lines to return

**New response fields on `read_repo_file`:**

- `line_start`, `line_end` — the 1-indexed range actually returned
- `total_lines` — how many lines the file has
- `truncated: true` — present when `line_end < total_lines`; agent should
  call again with `offset: line_end + 1` to continue

Before this change, `read_repo_file` returned the entire file regardless
of size. A 50KB connection spec or 2000-line lockfile would land in the
agent's next prompt verbatim, eating context budget for no reason. With
pagination the default read is bounded and the agent has the metadata it
needs to ask for more.

Also:

- `read_repo_file` now rejects binary files (NUL-byte heuristic) instead
  of returning mojibake.
- `read_many_repo_files` now reports `total_lines` for each file in the
  response, so when byte-based truncation fires the agent knows whether
  to switch to the paginated `read_repo_file` for the full content.
- New exported constants: `READ_FILE_DEFAULT_LINES`, `READ_FILE_MAX_LINES`.
