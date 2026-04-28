---
"@amodalai/runtime": patch
"@amodalai/react": patch
---

Wire context injection through request tool, add scope support to React SDK

The request tool bypassed contextInjection config from connection specs. Fixed by wiring loadedConnections and scopeContext through the tool factory. React SDK adds scopeId/scopeContext props to WidgetConfig and ChatWidget.
