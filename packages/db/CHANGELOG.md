# @amodalai/db

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
