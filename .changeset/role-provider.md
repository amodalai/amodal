---
"@amodalai/runtime": patch
---

Add RoleProvider interface for role-based access control. Hosting layers (cloud, self-hosted, `amodal dev`) plug in their own implementation to map requests to `user`/`admin`/`ops` roles. Adds `GET /api/me` endpoint and `requireRole` middleware factory. Default provider returns `ops` for all requests so `amodal dev` and existing deployments work unchanged.
