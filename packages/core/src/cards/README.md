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
