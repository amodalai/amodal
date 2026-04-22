---
"@amodalai/runtime": patch
---

Wire buildCredentialResolver into connection loading for scope:KEY resolution

The CredentialResolver factory on SharedResources is now called during session
creation and passed to the tool context factory. Connection auth tokens using
scope:KEY references are resolved via the pluggable resolver chain. Also adds
scope_id to the session logger context for observability.
