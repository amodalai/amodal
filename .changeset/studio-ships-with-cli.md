---
"@amodalai/amodal": patch
"@amodalai/studio": patch
---

Ship Studio with the CLI so `npm install -g @amodalai/amodal` gives
users the full stack. `amodal dev` now starts runtime + Studio +
admin agent without any extra install steps.

- Removed `"private": true` from `@amodalai/studio` so it publishes
  to npm alongside the other packages.
- Added `"@amodalai/studio": "workspace:*"` as a dependency of
  `@amodalai/amodal` (the CLI) so npm pulls it transitively.
- Added `@amodalai/studio` to the changeset fixed lockstep group and
  bumped its version to 0.3.1 to match the rest of the group.
- Added a `"files"` field to Studio's package.json so only the source
  files needed by `next dev` ship in the npm tarball (src, public,
  next.config.ts, postcss.config.cjs, tailwind.config.ts, tsconfig.json).
