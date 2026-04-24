# @amodalai/db

## 0.3.34

## 0.3.33

## 0.3.32

## 0.3.31

## 0.3.30

### Patch Changes

- [#272](https://github.com/amodalai/amodal/pull/272) [`3ea984e`](https://github.com/amodalai/amodal/commit/3ea984e4384142e225e8176469fb9db56437fa84) Thanks [@gte620v](https://github.com/gte620v)! - Clean up code comments that referenced ephemeral project state (phase/workstream/roadmap labels, gotcha indexes, "replaces upstream X" lineage, refactor code-names, PR numbers). No functional changes — comment-only edits so future readers see what the code is and does, not the project timeline that produced it.

## 0.3.29

## 0.3.28

### Patch Changes

- [#265](https://github.com/amodalai/amodal/pull/265) [`2b135e6`](https://github.com/amodalai/amodal/commit/2b135e6c5ece03d722d6018ca4a6f3faebbdc17d) Thanks [@whodatdev](https://github.com/whodatdev)! - Fix session persistence: stop dropping store tables on boot, stop deleting persisted sessions from the database on cleanup timer.

## 0.3.27

## 0.3.26

## 0.3.25

## 0.3.24

## 0.3.23

### Patch Changes

- [#249](https://github.com/amodalai/amodal/pull/249) [`c1e515b`](https://github.com/amodalai/amodal/commit/c1e515b81cbb286b2b6f99d39f29eeca08bc8621) Thanks [@gte620v](https://github.com/gte620v)! - Add scope_id support for per-user session isolation

  Adds `scope_id` to sessions, memory, and stores for multi-tenant data isolation.
  ISVs embed the agent in their app and pass a `scope_id` per end user — each scope
  gets its own memory, store partition, and session history. Includes ScopedStoreBackend
  wrapper for shared store enforcement, context injection into connections, and
  pluggable CredentialResolver for `scope:KEY` secret resolution.

## 0.3.22

## 0.3.21

## 0.3.20

## 0.3.19

## 0.3.18

### Patch Changes

- [#229](https://github.com/amodalai/amodal/pull/229) [`b8a6c07`](https://github.com/amodalai/amodal/commit/b8a6c07554c31fe2be96e50b5d34409d9877caf6) Thanks [@gte620v](https://github.com/gte620v)! - Add agent memory: per-instance persistent memory with update_memory tool

  Adds the Phase 1 memory feature: a single-row text blob per database that the agent
  reads from its system prompt and updates via the built-in `update_memory` tool.
  - New `agent_memory` table in `@amodalai/db` schema and migration
  - `memory` config block (`enabled`, `editableBy`) in amodal.json
  - Memory section in the context compiler (between knowledge and stores)
  - `update_memory` tool registered when memory is enabled and editable
  - Memory management instructions injected into the system prompt

## 0.3.17

## 0.3.16

## 0.3.15

## 0.3.14

## 0.3.13

## 0.3.12

## 0.3.11

## 0.3.10

## 0.3.9

## 0.3.8

## 0.3.7

## 0.3.6

## 0.3.5

## 0.3.4

## 0.3.3

## 0.3.2

## 0.3.1

### Patch Changes

- [#198](https://github.com/amodalai/amodal/pull/198) [`9833d69`](https://github.com/amodalai/amodal/commit/9833d696fb641d08f39fc3296f49a61c04350fe2) Thanks [@gte620v](https://github.com/gte620v)! - Publish `@amodalai/db` to npm. The 0.3.0 release of `@amodalai/runtime` and `@amodalai/amodal` declared a workspace dependency on `@amodalai/db@0.0.0`, which was never published (the package was `private: true`), causing `pnpm add -g @amodalai/amodal` to fail with an `ERR_PNPM_FETCH_404` on `@amodalai/db`. This release unprivate's the package, adds standard publish metadata, and brings it into the fixed version group so it is released in lockstep with the rest of the public packages.
