---
"@amodalai/types": patch
"@amodalai/core": patch
"@amodalai/runtime": patch
"@amodalai/cli": patch
---

Replace custom package registry with standard npm

Packages are now standard npm dependencies installed to node_modules/.
Declare installed packages in amodal.json `packages` array.

- Remove custom registry, hidden npm context (amodal_packages/), and lock file (amodal.lock)
- Add package-manager.ts (detectPackageManager, pmAdd, pmRemove, ensurePackageJson)
- Resolver loads declared packages using same nested structure as local repo
- amodal install/uninstall manage both npm deps and amodal.json packages array
- Remove publish, search, diff, update, list commands (use npm directly)
- Admin agent fetches from npmjs.org
