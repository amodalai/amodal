---
"@amodalai/react": patch
"@amodalai/runtime": patch
"@amodalai/runtime-app": patch
"@amodalai/amodal": patch
---

Remove app_id from client-server protocol. Server resolves app from hostname/auth context.

Breaking: AmodalProvider no longer accepts appId prop. RuntimeClient no longer sends app_id. SessionCreator and SessionHydrator signatures changed. Chat/task schemas no longer include app_id.

New: POST /auth/token on local dev returns empty token. useAuth hook replaces useHostedConfig. runtime-app publishes source for hosted builds. CLI deploy triggers remote Fly build.
