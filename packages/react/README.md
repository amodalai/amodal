# @amodalai/react

React hooks, components, and embeddable chat widget for adding Amodal agents to any web application.

## Install

```bash
npm install @amodalai/react
```

## Quick start

```tsx
import { ChatWidget } from "@amodalai/react/widget";
import "@amodalai/react/widget/style.css";

function App() {
  return (
    <ChatWidget
      endpoint="https://your-runtime.example.com"
      tenantId="your-tenant-id"
    />
  );
}
```

## What's included

- **Chat widget** — drop-in conversational UI with SSE streaming, tool call display, and theming via CSS custom properties
- **React hooks** — `useChat`, `useSessionHistory`, `useWidgetEvents` for building custom chat interfaces
- **SSE client** — `ChatClient` for connecting to the Amodal runtime from any JavaScript environment
- **Widget components** — entity cards, timelines, data tables, score breakdowns, and more

## Documentation

[docs.amodalai.com](https://docs.amodalai.com)

## License

[MIT](../../LICENSE)
