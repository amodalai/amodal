---
"@amodalai/snapshot-probe": patch
---

Initial release of `@amodalai/snapshot-probe`. Release pipeline smoke-test
package — exports a single string constant, has no runtime behavior, and
exists purely so the normal release workflow and the new snapshot release
workflow have a non-trivial package to publish when verifying the pipeline
end-to-end. Added to the fixed lockstep group alongside the production
packages so every monorepo release includes a probe publish.
