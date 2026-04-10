---
"@amodalai/runtime-app": patch
---

Add role-aware sidebar to runtime-app. New `useMe` hook calls the runtime's `/api/me` endpoint and returns the current user's role (`user`, `admin`, or `ops`). The main Sidebar and AppShell now hide ops-only items (connections, MCP servers, config gear) from non-ops users, and admin-only items (skills, knowledge, automations, stores, pages) from end-users. ConfigLayout redirects non-ops users to the chat. In `amodal dev` everyone is `ops` so the UI is unchanged.
