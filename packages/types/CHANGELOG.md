# @amodalai/types

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
