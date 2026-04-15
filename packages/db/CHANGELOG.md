# @amodalai/db

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
