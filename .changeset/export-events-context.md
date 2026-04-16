---
"@amodalai/studio": patch
---

Export the events context, types, and hook from StudioEventsContext so external deployments can provide their own real-time events implementation. Make the App component accept an optional `eventsProvider` prop to swap the default SSE provider.
