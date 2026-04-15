# @amodalai/types

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

- [#172](https://github.com/amodalai/amodal/pull/172) [`9599b4e`](https://github.com/amodalai/amodal/commit/9599b4e840cef07f3b443b0b2d490d2deabcb517) Thanks [@gte620v](https://github.com/gte620v)! - Add image paste support to chat

  Users can paste images from the clipboard into the chat input. Images show as removable thumbnails before sending, then render in the user message bubble. Vision-capable providers (Anthropic, Google, OpenAI) receive the image; non-vision providers strip it with a warning. Images are stored in a separate `image_data` column to avoid JSONB bloat, with automatic rehydration on session load.

## 0.2.3

### Patch Changes

- [#169](https://github.com/amodalai/amodal/pull/169) [`83d0153`](https://github.com/amodalai/amodal/commit/83d01530ae0b85cf7333df75e6fe15cabb1cb63b) Thanks [@whodatdev](https://github.com/whodatdev)! - Add messaging channels to deploy snapshots

## 0.2.2

### Patch Changes

- [#167](https://github.com/amodalai/amodal/pull/167) [`f4d59ea`](https://github.com/amodalai/amodal/commit/f4d59eae060aa5fa35e1f2f756413457a4d5331b) Thanks [@whodatdev](https://github.com/whodatdev)! - Add messaging channel plugin system
  - Channel plugins are npm packages discovered via channel.json, dynamically loaded at boot
  - Webhook router at POST /channels/:channelType/webhook with dedup, rate limiting, session affinity
  - Drizzle and in-memory session mappers for channel user → session mapping
  - ChannelPlugin interface with optional setup() for interactive CLI configuration
  - `amodal connect channel <pkg>` and `amodal connect connection <pkg>` commands
  - ChannelSetupContext for plugin-owned setup flows (prompt, writeEnv, updateConfig)

- [#166](https://github.com/amodalai/amodal/pull/166) [`1523d96`](https://github.com/amodalai/amodal/commit/1523d96f2bb1d6b5e2f0023690f9abb371b88fd3) Thanks [@whodatdev](https://github.com/whodatdev)! - Replace custom package registry with standard npm

  Packages are now standard npm dependencies installed to node_modules/.
  Declare installed packages in amodal.json `packages` array.
  - Remove custom registry, hidden npm context (amodal_packages/), and lock file (amodal.lock)
  - Add package-manager.ts (detectPackageManager, pmAdd, pmRemove, ensurePackageJson)
  - Resolver loads declared packages using same nested structure as local repo
  - amodal install/uninstall manage both npm deps and amodal.json packages array
  - Remove publish, search, diff, update, list commands (use npm directly)
  - Admin agent fetches from npmjs.org

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

- [#152](https://github.com/amodalai/amodal/pull/152) [`745228d`](https://github.com/amodalai/amodal/commit/745228db110b6da50e0514f6dc90250037ada958) Thanks [@gte620v](https://github.com/gte620v)! - Add delivery routing for automations.

  Automations can now declare where their results go when they complete, and
  where failure alerts go when they fail repeatedly. Targets can be webhooks,
  ISV-provided callbacks, or multiple of each in parallel.

  ```json
  {
    "name": "scan-trending",
    "schedule": "0 */4 * * *",
    "prompt": "Scan for trending AI content",
    "delivery": {
      "targets": [
        { "type": "webhook", "url": "env:SLACK_WEBHOOK_URL" },
        { "type": "callback" }
      ],
      "template": "Found {{count}} new articles. Top: {{top_title}}"
    },
    "failureAlert": {
      "after": 3,
      "targets": [{ "type": "webhook", "url": "env:ALERT_WEBHOOK_URL" }],
      "cooldownMinutes": 60
    }
  }
  ```

  Features:
  - **Multiple targets in parallel.** Each target is dispatched concurrently.
  - **Template rendering** with `{{variable}}` substitution. Variables come from
    the automation's parsed JSON result (top-level keys) plus built-ins
    `{{automation}}`, `{{timestamp}}`, `{{result}}`. Missing variables stay as
    literal tokens and emit a `delivery_template_missing_var` log warning (once
    per automation+template+missing-key combo) so prompt drift is diagnosable.
    Template output is plain text — receivers that interpret markdown (Slack,
    GitHub) will render any markdown/tag syntax present in agent output.
  - **ISV callback targets** via `createLocalServer({ onAutomationResult })` —
    receive the full delivery payload plus target metadata (including the
    optional `name` field) so ISVs can distinguish between multiple callback
    targets on the same automation. Signature: `(payload, target) => void`.
  - **Failure alerting** with consecutive-failure tracking per automation, a
    configurable `after` threshold, and a `cooldownMinutes` window to prevent
    alert spam during sustained outages. Counter resets on success. Note:
    failure state is in-memory per process; restart resets counters and
    cooldown windows.
  - **Webhook retry** on transient failures — one retry with 1s delay on 5xx
    responses and network errors. 4xx responses do not retry.
  - **HMAC signing** on webhook deliveries when `webhookSecret` is configured.
    Receivers verify with: `expected = "sha256=" + hmac_sha256(secret, body)`
    against the `X-Amodal-Signature` header. Use constant-time comparison.
  - **Result truncation** at 16KB — long agent outputs are truncated (head+tail
    preserved around an elision marker) with `truncated: true` on the payload,
    so receivers with size caps (Slack 4KB, GitHub 64KB) aren't silently
    dropped. Templates receive the full untruncated text.
  - **env:NAME resolution** on webhook URLs happens at bundle-load time (in
    `bridgeAutomation`), so missing env vars fail fast at server boot with a
    `RepoError` — not at first delivery attempt. URLs are validated at parse
    time to require `http://`, `https://`, or `env:` prefix.
  - **Observability via event bus** — each delivery emits a `delivery_succeeded`
    or `delivery_failed` event with automation name, target type/url, HTTP
    status, duration, and retry attempt count, so operators can answer "which
    deliveries failed in the last hour?" without grepping logs.

  Backward compatible: automations without `delivery` or `failureAlert` fields
  run exactly as before. The `onAutomationResult` callback signature changed
  to `(payload, target)` — ISVs calling this will need to accept the second
  argument.

  New public types: `DeliveryTarget`, `DeliveryConfig`, `FailureAlertConfig`,
  `DeliveryPayload` in `@amodalai/types`. New event types:
  `DeliverySucceededEvent`, `DeliveryFailedEvent`.

- [#148](https://github.com/amodalai/amodal/pull/148) [`cdcf62f`](https://github.com/amodalai/amodal/commit/cdcf62f90f42a3a6064f7e86cdcfa0293493e949) Thanks [@gte620v](https://github.com/gte620v)! - Add runtime event bus for push-based UI updates.

  The runtime now emits typed lifecycle events (session_created/updated/deleted,
  automation_triggered/completed/failed, manifest_changed, files_changed) on an
  internal `RuntimeEventBus`. Events are streamed to clients over a new
  `/api/events` SSE endpoint.

  Clients connect once via EventSource and receive every state change in real
  time. Replaces `setInterval` polling in the runtime-app for session list,
  automation status, manifest reloads, file tree, and health checks. The UI now
  updates the instant something changes instead of on 3-10 second cycles.

  The bus buffers the last 200 events and supports `Last-Event-ID` for
  reconnect-and-resume, so clients never miss state changes across brief
  disconnects.

  New public types: `RuntimeEvent`, `RuntimeEventType`, `RuntimeEventPayload`.

- [#158](https://github.com/amodalai/amodal/pull/158) [`57b143f`](https://github.com/amodalai/amodal/commit/57b143fac3c0de23651dd26a295be9ee553a91d1) Thanks [@gte620v](https://github.com/gte620v)! - Add built-in `web_search` and `fetch_url` tools backed by Gemini Flash
  grounding. Enabled when `webTools` is configured in `amodal.json` with
  a Google API key:

  ```json
  {
    "webTools": {
      "provider": "google",
      "apiKey": "env:GOOGLE_API_KEY",
      "model": "gemini-3-flash-preview"
    }
  }
  ```

  `web_search` returns a synthesized answer with cited source URLs.
  `fetch_url` returns page content as markdown — Gemini `urlContext` is
  the primary path, with a local `fetch()` + Mozilla Readability fallback
  for private-network URLs (localhost, RFC1918) or Gemini failures. Both
  tools are registered automatically on every session when `webTools` is
  present. Per-hostname rate limiting (10 req / 60s) and a 2000-token
  cap apply to both tools.

## 0.2.0

## 0.1.26

### Patch Changes

- [#111](https://github.com/amodalai/amodal/pull/111) [`5b01f5e`](https://github.com/amodalai/amodal/commit/5b01f5e57792c94e51c286c7772095354684fdc8) Thanks [@gte620v](https://github.com/gte620v)! - Create @amodalai/types package with shared type definitions extracted from @amodalai/core. Zero runtime dependencies. Core re-exports all types for backward compatibility.
