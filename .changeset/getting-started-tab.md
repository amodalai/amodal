---
"@amodalai/studio": patch
---

Add a "Getting started" tab and `/agents/:agentId/getting-started` route.

Surfaces a stub page where first-run agent setup will live (slot picker, credentials checklist, identity prompts) — landing the route + nav entry first so the cloud onboarding flow can stop owning a separate `/setup` URL and route into the studio instead. Today the page just shows the agent's `envRefs` set/unset status; the rich configurator is a follow-up port from the cloud's old SetupPage.
