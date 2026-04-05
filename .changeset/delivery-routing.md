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
  literal tokens.
- **ISV callback targets** via `createLocalServer({ onAutomationResult })` —
  receive the full delivery payload in your own code without a webhook.
- **Failure alerting** with consecutive-failure tracking per automation, a
  configurable `after` threshold, and a `cooldownMinutes` window to prevent
  alert spam during sustained outages. Counter resets on success.
- **HMAC signing** on webhook deliveries when `webhookSecret` is configured.

Backward compatible: automations without `delivery` or `failureAlert` fields
run exactly as before.

New public types: `DeliveryTarget`, `DeliveryConfig`, `FailureAlertConfig`,
`DeliveryPayload` in `@amodalai/types`.
