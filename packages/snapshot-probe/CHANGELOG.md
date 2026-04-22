# @amodalai/snapshot-probe

## 0.3.29

## 0.3.28

## 0.3.27

## 0.3.26

## 0.3.25

## 0.3.24

## 0.3.23

## 0.3.22

## 0.3.21

## 0.3.20

## 0.3.19

## 0.3.18

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
