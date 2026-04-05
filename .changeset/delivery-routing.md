---
"@amodalai/runtime": patch
"@amodalai/core": patch
"@amodalai/types": patch
---

Add delivery routing for automations.

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
