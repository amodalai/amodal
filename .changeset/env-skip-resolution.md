---
"@amodalai/types": patch
"@amodalai/core": patch
---

Add skipEnvResolution option to loadRepo for build-time usage

When loading an agent repo at build time (e.g. in the cloud build server),
`env:VAR_NAME` references in amodal.json don't need to be resolved because
credentials aren't available. The new `skipEnvResolution` flag on
`RepoLoadOptions` skips env resolution and passes raw config values through
to schema validation.
