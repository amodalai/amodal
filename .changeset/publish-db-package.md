---
"@amodalai/db": patch
"@amodalai/runtime": patch
"@amodalai/amodal": patch
---

Publish `@amodalai/db` to npm. The 0.3.0 release of `@amodalai/runtime` and `@amodalai/amodal` declared a workspace dependency on `@amodalai/db@0.0.0`, which was never published (the package was `private: true`), causing `pnpm add -g @amodalai/amodal` to fail with an `ERR_PNPM_FETCH_404` on `@amodalai/db`. This release unprivate's the package, adds standard publish metadata, and brings it into the fixed version group so it is released in lockstep with the rest of the public packages.
