---
"@amodalai/runtime": minor
"@amodalai/core": patch
---

Unify local and hosted server onto a single SessionManager, replacing AgentSessionManager + runAgentTurn with SessionManager + streamMessage. Adds minimal Config init for non-Google providers, CustomToolAdapter for repo tools, and configurable coreTools from repo config.
