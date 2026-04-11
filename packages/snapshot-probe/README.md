# @amodalai/snapshot-probe

Release pipeline smoke-test package. Exists purely to exercise the publish
workflows end-to-end so we can tell whether a release ran correctly without
using a real published package as the canary.

**You probably don't want to install this.** It exports nothing useful. It's
here so that:

- Every normal monorepo release publishes this package alongside the real
  ones, proving the fixed-group lockstep and the NPM_TOKEN setup still work.
- The snapshot release workflow (`.github/workflows/release-snapshot.yml`)
  can publish a prerelease of this package from a feat branch and we can
  check `npm view @amodalai/snapshot-probe dist-tags` to see whether the
  snapshot tag made it through.

## Why a dedicated probe instead of relying on `@amodalai/core`

`@amodalai/core` is a real package consumed by production code. If a release
breaks it (either content-wise or pipeline-wise), rolling back requires real
thought. `snapshot-probe` has zero consumers, so a bad release of it can be
ignored and the next release fixes it. This keeps the release pipeline's
success signal decoupled from the production packages' code quality.

## How to use it as a liveness check

```ts
import { SNAPSHOT_PROBE } from "@amodalai/snapshot-probe";
console.log(SNAPSHOT_PROBE);
// → "@amodalai/snapshot-probe@release-pipeline-smoke-test"
```

That's it. The package has no other exports.
