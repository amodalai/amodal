---
"@amodalai/studio": patch
---

Fix file editor crash and draft workspace API calls

- listDrafts: API returns `{ drafts: [] }` not bare array — fix deserialization
- saveDraft: put file path in URL (`PUT /drafts/{path}`) not request body
- discardAll: use `POST /discard` endpoint, not `DELETE /drafts`
