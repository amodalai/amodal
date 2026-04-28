---
"@amodalai/types": patch
"@amodalai/core": patch
"@amodalai/runtime": patch
---

Allow `amodal.json#packages` entries to opt into a subset of a multi-role package via `use:`.

Each entry can now be either a bare string (load every sub-thing — same as before) or an object `{ package, use }` where `use` is an array of `<kind>.<name>` selectors. Default behaviour when `use` is omitted is to load everything, so existing configs need no changes.

```json
"packages": [
  "@scope/connection-foo",
  { "package": "@scope/multi", "use": ["connections.slack", "channels.bot"] }
]
```

The resolver builds a per-kind filter from `use` and applies it to the connection / skill / automation / knowledge / store / tool / channel scans. New helpers `normalizePackageEntry` and `buildSubthingFilter` are exported from `@amodalai/core` for cloud consumers that need to mirror the same logic.
