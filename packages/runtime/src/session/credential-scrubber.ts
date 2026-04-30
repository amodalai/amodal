/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Credential scrubber — Phase F.5 of the admin-setup build plan.
 *
 * Belt-and-suspenders for the inline-paste credential redirect rule
 * (F.4): if the user pastes a token in chat anyway, the runtime
 * still sees the raw text in the active SSE stream so the agent can
 * recognize and redirect — but anything written to the database via
 * `sessionToRow` is sanitized to `[REDACTED]`.
 *
 * The scrubber runs at the persistence boundary, not on the
 * in-memory message array. The agent's reasoning context keeps the
 * raw text for one turn (it needs to see the credential to recognize
 * it as one); only the persisted history is sanitized.
 */

const REDACTED = '[REDACTED]';

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/**
 * Well-known credential prefixes. Each entry is a single regex that
 * matches the whole token; we replace with `[REDACTED]` to fully
 * sanitize. Adding a new vendor: extend the alternation; tests pin
 * the existing matches.
 */
const TOKEN_PREFIX_PATTERNS: readonly RegExp[] = [
  // Slack: xoxb-, xoxp-, xapp-, xoxa-, xoxr-, xoxs- followed by dash-separated segments.
  /\bxox[abprs]-[A-Za-z0-9-]{20,}/g,
  // Slack app-level token: xapp-1-...
  /\bxapp-\d+-[A-Za-z0-9-]{20,}/g,
  // Stripe (and Stripe-style) live + test keys: sk_live_..., sk_test_..., pk_live_..., pk_test_...
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g,
  // Anthropic Claude API keys: sk-ant-api03-...
  /\bsk-ant-(?:api|sid)\d+-[A-Za-z0-9_-]{16,}/g,
  // OpenAI API keys: sk-... (older format) and sk-proj-... (project-scoped).
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/g,
  // GitHub PATs / fine-grained / install tokens: ghp_, gho_, ghr_, ghs_, gha_, github_pat_
  /\bgh[opsra]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  // Google API keys: AIza...
  /\bAIza[A-Za-z0-9_-]{30,}/g,
  // AWS access key id: AKIA + 16 chars; secret keys are 40-char base64ish.
  /\bAKIA[A-Z0-9]{14,20}/g,
  // Resend API keys: re_... + 20+ chars.
  /\bre_[A-Za-z0-9]{20,}/g,
  // SendGrid API keys: SG.<24>.<43+>
  /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{40,}/g,
  // Twilio auth tokens: 32-char hex (without a public prefix). Only
  // match when adjacent to a "TWILIO_AUTH_TOKEN" hint so we don't
  // chew on every 32-char hex string. Handled via env-var line scrub
  // below; intentionally not added as a standalone pattern.
  // HuggingFace user access tokens: hf_...
  /\bhf_[A-Za-z0-9]{30,}/g,
];

/**
 * `KEY=VALUE` env-var line shape. Matches a line that opens with an
 * uppercase env-var-style key followed by `=` and 16+ non-whitespace
 * characters. Catches `SLACK_BOT_TOKEN=xoxb-…` even when the value
 * format isn't in our prefix list (e.g. raw 32-char hex tokens like
 * Twilio's auth token).
 *
 * The match is intentionally line-anchored — `KEY=VALUE` mid-prose
 * is ambiguous (could be code-snippet output the agent should see).
 * If it shows up at the start of a line, treat as a credential.
 *
 * We preserve the key name (so the agent / user can see what they
 * tried to paste) and replace only the value with `[REDACTED]`.
 */
const ENV_VAR_LINE_PATTERN = /^(\s*)([A-Z][A-Z0-9_]{2,}=)([^\s]{16,})$/gm;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scrub credential-shaped substrings from a string. Returns the
 * input unchanged when no match is found; otherwise returns a copy
 * with each match replaced by `[REDACTED]` (or `KEY=[REDACTED]`
 * for env-var lines).
 */
export function scrubCredentials(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  let scrubbed = text;
  for (const pattern of TOKEN_PREFIX_PATTERNS) {
    scrubbed = scrubbed.replace(pattern, REDACTED);
  }
  scrubbed = scrubbed.replace(ENV_VAR_LINE_PATTERN, (_match, indent: string, keyEq: string) =>
    `${indent}${keyEq}${REDACTED}`,
  );
  return scrubbed;
}

/**
 * Scrub the messages array from a session's PersistedSession before
 * write. Walks every user-role message and replaces credential-shaped
 * substrings inside text content.
 *
 * Assistant messages aren't scrubbed because:
 *   1. The model isn't supposed to echo credentials (and the F.4
 *      prompt rule plus this scrubber's coverage of user input mean
 *      it never sees them in the first place).
 *   2. Scrubbing assistant output could chew on legitimately
 *      credential-shaped strings the agent quotes from a connection
 *      package's docs (e.g. "the format is sk_live_…").
 *
 * Tool-result messages aren't scrubbed because they're already
 * structured by the tool and the chat surface; if a tool returns a
 * raw token in its output, that's a tool bug to fix in the tool, not
 * a generic scrubber concern.
 *
 * The function is shape-tolerant — it walks any object/array and
 * applies the scrubber to string-valued `text` / `content` fields
 * inside user-role messages. Anything else passes through unchanged.
 */
export function scrubMessagesForPersistence(
  messages: readonly unknown[],
): unknown[] {
  return messages.map((message) => {
    if (!isObject(message)) return message;
    if (message['role'] !== 'user') return message;
    return scrubUserMessage(message);
  });
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function scrubUserMessage(message: Record<string, unknown>): Record<string, unknown> {
  const content = message['content'];
  if (typeof content === 'string') {
    return {...message, content: scrubCredentials(content)};
  }
  if (Array.isArray(content)) {
    return {...message, content: content.map(scrubContentPart)};
  }
  return message;
}

function scrubContentPart(part: unknown): unknown {
  if (!isObject(part)) return part;
  // The Vercel AI SDK ModelMessage user-content shape: {type: 'text', text: '...'}
  // or {type: 'image', image: '...', mediaType: '...'}. We only scrub text parts.
  if (part['type'] === 'text' && typeof part['text'] === 'string') {
    return {...part, text: scrubCredentials(part['text'])};
  }
  return part;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
