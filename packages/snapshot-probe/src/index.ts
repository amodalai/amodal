/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * `@amodalai/snapshot-probe` is a smoke-test package for the amodal release
 * pipeline. It exists so the normal `release.yml` and the snapshot
 * `release-snapshot.yml` workflows have a package they can publish end-to-end
 * to validate that:
 *
 *   - the npm scope + token are correctly configured;
 *   - the fixed-group lockstep bump includes this package;
 *   - dist-tag routing (`latest` for main releases, `next-*` for snapshots)
 *     works as expected;
 *   - first-time publishes of a brand-new scoped package succeed.
 *
 * The package has no runtime code — it exports a single string constant
 * identifying the release channel. Downstream consumers can `import` it as a
 * liveness check, but in practice nothing is expected to depend on it.
 */
export const SNAPSHOT_PROBE = '@amodalai/snapshot-probe@release-pipeline-smoke-test' as const;
