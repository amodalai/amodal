---
"@amodalai/runtime": patch
"@amodalai/runtime-app": patch
---

Add role-gated file access and the foundation for the deploy diff view.

`/api/files` routes (GET tree, GET file, PUT file) now consult the configured `RoleProvider` and gate access by role:

- `ops` can read/write anything in the repo (subject to existing path-traversal checks)
- `admin` can read/write only `skills/`, `knowledge/`, and `agents/` directories. Tree response is filtered to those directories.
- `user` is denied entirely with 403
- Unauthenticated requests get 401

Default behavior in `amodal dev` is unchanged because the default `RoleProvider` returns `ops` for everyone.

Adds a new `DiffView` React component plus a `computeLineDiff` LCS-based line-diff utility (no new dependencies). The component is ready to render unified diffs but is not yet wired into a backend diff endpoint — that comes in a follow-up PR (`/api/workspace/diff` in the cloud repo).

The `WorkspaceBar`'s "Persist" button now opens a `DeployConfirmModal` that lists the files about to be deployed. The actual line-by-line diffs will be added once the workspace diff endpoint exists in cloud.
