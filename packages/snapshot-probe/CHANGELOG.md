# @amodalai/snapshot-probe

## 0.3.4

## 0.3.3

## 0.3.2

## 0.3.1

## 0.3.0

## 0.2.10

## 0.2.9

### Patch Changes

- [#189](https://github.com/amodalai/amodal/pull/189) [`9a419e2`](https://github.com/amodalai/amodal/commit/9a419e2c6d29f03077fea2c01ae40d735f5b016c) Thanks [@gte620v](https://github.com/gte620v)! - Initial release of `@amodalai/snapshot-probe`. Release pipeline smoke-test
  package — exports a single string constant, has no runtime behavior, and
  exists purely so the normal release workflow and the new snapshot release
  workflow have a non-trivial package to publish when verifying the pipeline
  end-to-end. Added to the fixed lockstep group alongside the production
  packages so every monorepo release includes a probe publish.
