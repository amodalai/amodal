---
"@amodalai/amodal": patch
"@amodalai/runtime-app": patch
---

Publish runtime-app to npm so the web chat UI works with global CLI installs. Previously marked private, which meant `npm install -g @amodalai/amodal` couldn't resolve the runtime-app dependency.
