---
"@amodalai/studio": patch
---

Fix lib build by replacing Next.js-only `cache: 'no-store'` fetch option with `next: { revalidate: 0 }` in runtime-client. The previous option doesn't exist on the standard Node.js RequestInit type, causing tsc --build to fail and publishing an empty dist/.
