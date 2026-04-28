# @amodalai/react

## 0.3.40

### Patch Changes

- 9a6f63a: Wire context injection through request tool, add scope support to React SDK

  The request tool bypassed contextInjection config from connection specs. Fixed by wiring loadedConnections and scopeContext through the tool factory. React SDK adds scopeId/scopeContext props to WidgetConfig and ChatWidget.

## 0.3.39

## 0.3.38

### Patch Changes

- d215ab5: Rebrand from blue to teal accent colors and update logo to new geometric "A" mark

## 0.3.37

## 0.3.36

## 0.3.35

## 0.3.34

## 0.3.33

## 0.3.32

## 0.3.31

## 0.3.30

## 0.3.29

### Patch Changes

- [#266](https://github.com/amodalai/amodal/pull/266) [`2e1974b`](https://github.com/amodalai/amodal/commit/2e1974b2f3852efab849710856420cd4198347ae) Thanks [@whodatdev](https://github.com/whodatdev)! - Support async getToken for token refresh before chat requests. Fixes intermittent 401 errors on SSE streams when cached tokens expire.

## 0.3.28

## 0.3.27

## 0.3.26

## 0.3.25

## 0.3.24

## 0.3.23

## 0.3.22

## 0.3.21

## 0.3.20

### Patch Changes

- [#242](https://github.com/amodalai/amodal/pull/242) [`abb3c8f`](https://github.com/amodalai/amodal/commit/abb3c8f48e546262edb1faeafb6fed05f5199d86) Thanks [@gte620v](https://github.com/gte620v)! - Reconcile ChatWidget and ChatPage: add markdown rendering (react-markdown), image paste, confirmation cards, feedback buttons, and elapsed timer to ChatWidget. Replace runtime-app's custom ChatPage with thin wrapper around ChatWidget. Replace Studio's AdminChat with ChatWidget (custom streamFn support). Delete Studio's duplicate ToolCallCard. Add shared FormattedMarkdown component.

## 0.3.19

## 0.3.18

## 0.3.17

## 0.3.16

## 0.3.15

## 0.3.14

## 0.3.13

## 0.3.12

## 0.3.11

## 0.3.10

## 0.3.9

## 0.3.8

## 0.3.7

## 0.3.6

## 0.3.5

## 0.3.4

## 0.3.3

## 0.3.2

## 0.3.1

## 0.3.0

## 0.2.10

## 0.2.9

## 0.2.8

## 0.2.7

## 0.2.6

## 0.2.5

## 0.2.4

### Patch Changes

- [#174](https://github.com/amodalai/amodal/pull/174) [`0132204`](https://github.com/amodalai/amodal/commit/0132204a35f457e067fc5150a219f264a0f0955c) Thanks [@gte620v](https://github.com/gte620v)! - Add image output support in tool results. Tool call results are now sent to the frontend via SSE. MCP adapter preserves image content blocks instead of discarding them. Google provider extracts Gemini native image parts. Image-aware snipping prevents base64 data from being destroyed by truncation. New ImagePreview component renders image thumbnails in ToolCallCard.

- [#172](https://github.com/amodalai/amodal/pull/172) [`9599b4e`](https://github.com/amodalai/amodal/commit/9599b4e840cef07f3b443b0b2d490d2deabcb517) Thanks [@gte620v](https://github.com/gte620v)! - Add image paste support to chat

  Users can paste images from the clipboard into the chat input. Images show as removable thumbnails before sending, then render in the user message bubble. Vision-capable providers (Anthropic, Google, OpenAI) receive the image; non-vision providers strip it with a warning. Images are stored in a separate `image_data` column to avoid JSONB bloat, with automatic rehydration on session load.

## 0.2.3

## 0.2.2

### Patch Changes

- [#162](https://github.com/amodalai/amodal/pull/162) [`a33e080`](https://github.com/amodalai/amodal/commit/a33e0807e6607c88aa203f5dd2c1bf89299026d8) Thanks [@whodatdev](https://github.com/whodatdev)! - Remove userId, userRoles, and userContext from the OSS runtime

  The local runtime is single-tenant with no user system. Role-based access
  control is now the responsibility of the hosting layer via the new
  `onSessionBuild` hook on `CreateServerOptions`.
  - Removed `userRoles` from FieldScrubber, OutputGuard, Session, AgentContext, ToolContext
  - Removed `userContext` from AmodalConfig
  - Removed `role` from chat request schema and React client
  - Simplified `role_gated` policy to always deny (same as `never_retrieve`)
  - Deleted PreferenceClient, ScopeChecker, user-context-fetcher
  - Added `onSessionBuild` hook for hosting layer to enhance session components

## 0.2.1

### Patch Changes

- [#163](https://github.com/amodalai/amodal/pull/163) [`7d6e825`](https://github.com/amodalai/amodal/commit/7d6e8257b790380ca599c8cb1a0d937bb3741dd1) Thanks [@gte620v](https://github.com/gte620v)! - Unify chat-stream plumbing behind a single canonical `useChatStream`
  hook. Both `useChat` and `useAmodalChat` now delegate to it, and the
  admin chat in the runtime app gets tool-call callouts for free — it
  previously rolled its own SSE parser that silently dropped every
  event type except `init`, `text_delta`, and `error`.

  `useChatStream` owns the reducer, the SSE → action mapping, and the
  widget event bus. Consumers inject transport via a `streamFn` option:

  ```ts
  const stream = useChatStream({
    streamFn: (text, signal) =>
      streamSSE("/my/endpoint", { message: text }, { signal }),
    onToolCall: (call) => console.log("tool finished:", call),
  });
  ```

  The public API of `useChat` and `useAmodalChat` is unchanged — the
  refactor is internal. No behavior changes for existing consumers
  beyond a few previously-missing fixes that are now in the canonical
  reducer (e.g. `parameters` fallback on `tool_call_result`, usage
  accumulation on `done`).

  New exports from `@amodalai/react`:
  - `useChatStream`, `UseChatStreamOptions`, `UseChatStreamReturn`
  - `chatReducer` (re-exported from the canonical location)

## 0.2.0

## 0.1.26

## 0.1.25

## 0.1.24

## 0.1.23

## 0.1.22

## 0.1.21

## 0.1.20

### Patch Changes

- [#89](https://github.com/amodalai/amodal/pull/89) [`5fa7089`](https://github.com/amodalai/amodal/commit/5fa7089e2ee8ee92432fc3891fa859779507d1bb) Thanks [@whodatdev](https://github.com/whodatdev)! - Rename AmodalRepo to AgentBundle across public APIs: snapshotToRepo → snapshotToBundle, repoProvider → bundleProvider, getRepo → getBundle, updateRepo → updateBundle, SnapshotServerConfig.repo → .bundle, SessionManagerOptions.repo → .bundle. Fix "New chat" button not resetting the chat when already on the chat screen. Fix useAmodalChat reset() not clearing sessionIdRef.

## 0.1.19

## 0.1.18

### Patch Changes

- [#85](https://github.com/amodalai/amodal/pull/85) [`c8b5bae`](https://github.com/amodalai/amodal/commit/c8b5bae686a8225cf80331d339db4c79eaf0009d) Thanks [@whodatdev](https://github.com/whodatdev)! - Remove app_id from client-server protocol. Server resolves app from hostname/auth context.

  Breaking: AmodalProvider no longer accepts appId prop. RuntimeClient no longer sends app_id. SessionCreator and SessionHydrator signatures changed. Chat/task schemas no longer include app_id.

  New: POST /auth/token on local dev returns empty token. useAuth hook replaces useHostedConfig. runtime-app publishes source for hosted builds. CLI deploy triggers remote Fly build.

## 0.1.17

### Patch Changes

- [#79](https://github.com/amodalai/amodal/pull/79) [`fb49f28`](https://github.com/amodalai/amodal/commit/fb49f284bc427e7dc13a0c43653a55a28b23afb3) Thanks [@gte620v](https://github.com/gte620v)! - Add user feedback system: thumbs up/down on responses with admin synthesis
  - Thumbs up/down on assistant messages in dev UI chat and embedded React widget
  - Optional text comment on thumbs down
  - Feedback persisted to .amodal/feedback/ as JSON files
  - Admin dashboard page with stats, feedback list, and LLM synthesis button
  - Admin agent can query feedback via internal_api tool

## 0.1.16

## 0.1.15

## 0.1.14

### Patch Changes

- [#60](https://github.com/amodalai/amodal/pull/60) [`ca4285d`](https://github.com/amodalai/amodal/commit/ca4285d545290ef6c61b0b39d7cfce7ca19e236c) Thanks [@gte620v](https://github.com/gte620v)! - Session rename/delete, rich tool call cards, admin chat split pane, suppress OpenTelemetry warning, init cleanup.

## 0.1.13

## 0.1.12

## 0.1.11

## 0.1.10

## 0.1.9

### Patch Changes

- [#35](https://github.com/amodalai/amodal/pull/35) [`f9d4e5f`](https://github.com/amodalai/amodal/commit/f9d4e5fde9c623a8f93f8ab6471263824489a86a) Thanks [@gte620v](https://github.com/gte620v)! - Display token usage in the web chat UI. Tracks cumulative input/output tokens across all turns in a session. Usage data flows from LLM provider → agent runner → SSE done event → react hook → UI.

## 0.1.8

## 0.1.7

## 0.1.6

## 0.1.5

## 0.1.4

## 0.1.3

## 0.1.2

## 0.1.1

### Patch Changes

- [#1](https://github.com/amodalai/amodal/pull/1) [`3b76e05`](https://github.com/amodalai/amodal/commit/3b76e0594f3c71fda26481342ff3bf445a7e291b) Thanks [@whodatdev](https://github.com/whodatdev)! - Merge chat-widget into react package. All widget components, hooks, and event system now exported from @amodalai/react.
