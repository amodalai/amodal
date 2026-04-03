---
"@amodalai/runtime": patch
---

Extract PermissionChecker interface and rewrite request tool with Zod schemas for the new ToolRegistry. Includes AccessJsonPermissionChecker wrapping ActionGate with intent/method validation, delegation, and threshold escalation.
