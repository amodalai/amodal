---
"@amodalai/studio": patch
---

Fix Studio asset paths when served under BASE_PATH

The pre-built Studio has asset paths baked with `base: '/'` by Vite. When served under a subpath like `/studio/`, CSS and JS failed to load. Now the server rewrites `href="/"` and `src="/"` in the HTML to include the base path prefix at serve time.
