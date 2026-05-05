---
"@amodalai/studio": patch
---

Fix Skip-onboarding button — navigate back to the agent root after `init-repo` succeeds so IndexPage's `useRepoState` probe re-fires and routes to OverviewPage. Previously the button posted `init-repo` successfully but left the user stranded on `/setup` because the polling that would have swapped to OverviewPage doesn't run from that route post-v4.
