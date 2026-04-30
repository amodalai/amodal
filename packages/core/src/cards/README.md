# Agent cards

A template surfaces in the Studio gallery (and inline in admin chat) by shipping an **agent card** — a curated conversation snippet that shows what the agent actually says.

Cards travel with the template package and version with it. Studio renders them; the registry just orders them.

## Files

```
my-template/
├── card/
│   ├── card.json       ← required — thumbnail
│   └── preview.json    ← optional — expanded view
├── connections/
├── skills/
├── amodal.json
└── README.md
```

A template without `card/card.json` won't surface in the gallery. Loaders return `null` rather than throwing, so the rest of the template (skills, connections, etc.) still loads.

## `card/card.json`

The thumbnail shown on the home screen, in the gallery grid, and inline in admin chat. 2-4 turn conversation, 8-12 lines max.

```json
{
  "title": "Monday Marketing Digest",
  "tagline": "Weekly metrics summary → Slack.",
  "platforms": ["Google Analytics", "LinkedIn", "Slack"],
  "thumbnailConversation": [
    {
      "role": "agent",
      "content": "Your weekly marketing digest is ready.\n\nWebsite: 12.4k sessions (+8%)\nLinkedIn: 2.1k impressions, top post: \"Why we switched to...\" (847 clicks)\nAd spend: $2,340 — ROAS 3.2x ✓\n\n⚠ Instagram engagement down 12%. Recommend refreshing creative."
    },
    {
      "role": "user",
      "content": "Break this down by campaign."
    },
    {
      "role": "agent",
      "content": "Here's your campaign breakdown:\n• Brand awareness: $890, 45k impr, CPC $0.42\n• Product launch: $1,450, ROAS 4.1x ← winner\n• Retargeting: paused (budget depleted Thu)"
    }
  ]
}
```

| Field                   | Required | Notes                                                                           |
| ----------------------- | -------- | ------------------------------------------------------------------------------- |
| `title`                 | yes      | Display title.                                                                  |
| `tagline`               | yes      | One-line "what it does" under the title.                                        |
| `platforms`             | no       | Connected services to surface as chips. Defaults to `[]`.                       |
| `thumbnailConversation` | yes      | At least one turn. Each turn is `{ role: "user" \| "agent", content: string }`. |

## `card/preview.json`

Optional. The longer version shown when a user clicks into the card or when the admin agent surfaces the template inline. 4-8 turns is typical.

```json
{
  "title": "Monday Marketing Digest",
  "description": "Posts a metrics summary to Slack every Monday. Connects to your analytics, social platforms, and ad accounts and highlights what's working, what's not, and what needs attention.",
  "platforms": ["Google Analytics", "LinkedIn", "Instagram", "Slack"],
  "conversation": [
    { "role": "agent", "content": "..." },
    { "role": "user", "content": "..." },
    { "role": "agent", "content": "..." }
  ]
}
```

`description` replaces `tagline` and is shown beneath the conversation. Same `conversation` shape as the thumbnail, just longer.

## What makes a good card

- **Lead with agent output.** Not a greeting, not "How can I help?" — the digest, the schedule, the triage decision.
- **Show one user follow-up.** Demonstrates the agent is interactive, not a scheduled report.
- **Show the agent responding to it.** Depth, not just a one-shot output.
- **Use realistic data.** Names, numbers, percentages that look real. Not "Lorem ipsum".
- **Fit in a card.** ~8-12 lines for the thumbnail.

See `internal-docs/onboarding/design-v4.md` for the full design rationale.

## Loading

```ts
import { loadAgentCard, loadAgentCardPreview } from "@amodalai/core";

const card = await loadAgentCard(templateRoot); // → AgentCard | null
const preview = await loadAgentCardPreview(templateRoot); // → AgentCardPreview | null
```

Both throw `RepoError` (codes `CONFIG_PARSE_FAILED`, `CONFIG_VALIDATION_FAILED`, `READ_FAILED`) on malformed input.

---

# Connection validation probes

A connection package can ship a `validate.js` module exporting one or more named async probe functions. The admin agent calls each probe immediately after a successful Connect to surface a real data point inline ("Found 12 channels", "8.2k sessions this week") — turning "Connected" from a label into proof of value.

Probes are loaded by `@amodalai/agent-admin`'s `validate_connection` custom tool, which dynamic-imports `node_modules/<packageName>/validate.js` through a `data:text/javascript;base64` URL.

## File layout

```
my-connection/
├── connections/
│   └── <name>/
│       ├── spec.json
│       ├── access.json
│       └── …
├── validate.js          ← probes live here
├── package.json         ← must include "validate.js" in `files`
└── README.md
```

`package.json#files` must list `validate.js` so the probe ships in the published tarball.

## Probe shape

```js
// validate.js
export async function list_channels() {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return {
      ok: false,
      reason: "auth_failed",
      message: "SLACK_BOT_TOKEN is not set",
    };
  }
  const res = await fetch(
    "https://slack.com/api/conversations.list?limit=200",
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) {
    return {
      ok: false,
      reason: "error",
      message: `Slack returned HTTP ${res.status}`,
    };
  }
  const data = await res.json();
  if (!data.ok) {
    return { ok: false, reason: "auth_failed", message: data.error };
  }
  return { ok: true, channelCount: data.channels?.length ?? 0 };
}
```

Authoring rules:

- **Plain ES module.** No imports — only globals (`fetch`, `process.env`, `AbortSignal`, `Intl`). The runtime dynamic-imports via data URL, so `import` statements have no resolution context.
- **Async functions.** The probe runs server-side and is awaited.
- **Return primitives + arrays of primitives.** Strings, numbers, booleans, null, or arrays of those. Nested objects are scrubbed by `validate_connection` before reaching the LLM.
- **Soft-fail with a typed reason.** `{ok: false, reason: 'auth_failed' | 'no_data' | 'error', message?: string}`. Let unexpected throws bubble — the tool catches and reports them as `error`.
- **Read credentials from `process.env`.** The OAuth callback (or Configure modal) writes the env vars during Connect; the probe reads them. The credential never enters tool args, chat history, or the LLM's reasoning.
- **Use `AbortSignal.timeout(10_000)` on each fetch.** A hung API call shouldn't eat the validate_connection tool's full 15s timeout.

## ProbeResult contract

```ts
type ProbeFailureReason = "auth_failed" | "no_data" | "error";

type ProbeResult =
  | ({ ok: true } & Record<
      string,
      string | number | boolean | Array<string | number | boolean> | null
    >)
  | { ok: false; reason: ProbeFailureReason; message?: string };
```

Defined as `ProbeResult` in `@amodalai/types/validation.ts`. Probes don't need to import the type — the structural shape is what the tool checks at runtime.

## What `validate_connection` does with the result

The admin agent calls:

```ts
validate_connection({
  packageName: "@amodalai/connection-slack",
  probeName: "list_channels",
  extractPath: "channelCount", // optional — defaults to first primitive field
  format: "count", // 'count' | 'currency' | 'name' | 'raw'
});
```

On `{ok: true}`: the tool extracts the value at `extractPath`, applies `format`, and returns `{ok: true, value, formatted}`. The agent's prompt copies `formatted` verbatim into chat ("Found 12 channels", "8.2k sessions this week").

On `{ok: false}`: the tool returns the same shape; the agent's prompt branches on `reason` (per agent-admin/agents/main.md):

- `auth_failed` → re-emit the Connect card so the user can retry.
- `no_data` → "I connected {Name} but I'm seeing no data — want to try a different account?" with a retry button.
- `error` → skip silently and proceed.

## Examples

The first-party probes ship in `@amodalai/connection-slack` and `@amodalai/connection-ga4`. Read those files for working references; they cover OAuth-bearer auth, multi-step probes (GA4 lists properties, then runs a sessions report), and all three soft-fail reasons.

## Security

- The probe runs with full Node access (same trust as any installed npm package — installing the connection is the trust boundary).
- The credential is never reachable from the LLM: tools have no `ctx.saveSecret`, the probe reads `process.env` directly, and only the extracted primitive value reaches chat history.
- Probes return primitives only. If a probe accidentally returns a nested object, `validate_connection` rejects it with `error`, never echoes it.
- See `packages/runtime/src/tools/README.md` for the broader custom-tool SDK contract.
