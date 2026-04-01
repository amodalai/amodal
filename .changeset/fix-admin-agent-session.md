---
"@amodalai/runtime": patch
---

Fix admin agent session: restore skills, knowledge, file tools, and path validation

The session manager refactor (#68) broke the admin agent by dropping admin skills/knowledge from the prompt, removing file tools (read/write/delete_repo_file), and losing path validation. Admin sessions now temporarily swap repo fields to inject admin content, register file tools with full security checks, and verify local-only access.
