---
"@amodalai/studio": patch
"@amodalai/runtime": patch
---

Fix Studio not loading after npm install

Studio's package.json exports field didn't expose `./package.json`,
so `require.resolve('@amodalai/studio/package.json')` failed when
the CLI tried to locate the Studio package. This caused Studio to
silently skip on every `amodal dev` run from an npm-installed CLI.
