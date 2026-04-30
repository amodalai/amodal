/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase F.5 — credential scrubber tests. Pin each token-prefix
 * pattern, the env-var line shape, and the user-message-only walking
 * behaviour. The asserted leakage check at the bottom is the
 * load-bearing guarantee: no recognized credential shape survives
 * `scrubMessagesForPersistence`.
 */

import {describe, expect, it} from 'vitest';

import {
  scrubCredentials,
  scrubMessagesForPersistence,
} from './credential-scrubber.js';

describe('scrubCredentials — token prefix patterns', () => {
  it('redacts Slack bot, user, app, and admin tokens', () => {
    // Synthetic fixtures: structurally match the scrubber regex
    // (`xox[abprs]-[A-Za-z0-9-]{20,}` etc.) but use EXAMPLE / TEST
    // markers instead of realistic-looking segments so the values
    // can't be misread as real Slack tokens by secret scanners.
    const tokens = [
      'xoxb-EXAMPLE-EXAMPLE-EXAMPLEEXAMPLEEXAMPLE',
      'xoxp-EXAMPLE-EXAMPLE-EXAMPLEEXAMPLEEXAMPLE',
      'xoxa-1-EXAMPLE-EXAMPLE-EXAMPLEEXAMPLEEXAMPLE',
      'xapp-1-EXAMPLE-EXAMPLE-EXAMPLEEXAMPLEEXAMPLE',
    ];
    for (const t of tokens) {
      const scrubbed = scrubCredentials(`my token is ${t} please keep`);
      expect(scrubbed).toContain('[REDACTED]');
      expect(scrubbed).not.toContain(t);
    }
  });

  it('redacts Stripe live + test keys (sk_/pk_/rk_)', () => {
    const tokens = [
      'sk_live_abcdef0123456789ABCDEF',
      'sk_test_abcdef0123456789ABCDEF',
      'pk_live_abcdef0123456789ABCDEF',
      'rk_test_abcdef0123456789ABCDEF',
    ];
    for (const t of tokens) {
      expect(scrubCredentials(`use ${t} now`)).not.toContain(t);
    }
  });

  it('redacts Anthropic API keys', () => {
    const t = 'sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890';
    expect(scrubCredentials(`KEY: ${t}`)).not.toContain(t);
  });

  it('redacts OpenAI API keys (legacy + project-scoped)', () => {
    const legacy = 'sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aB';
    const proj = 'sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aB';
    expect(scrubCredentials(`legacy ${legacy}`)).not.toContain(legacy);
    expect(scrubCredentials(`proj ${proj}`)).not.toContain(proj);
  });

  it('redacts GitHub PATs and fine-grained tokens', () => {
    const tokens = [
      'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789',
      'gho_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789',
      'ghs_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789',
      'github_pat_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789_extra',
    ];
    for (const t of tokens) {
      expect(scrubCredentials(`token: ${t}`)).not.toContain(t);
    }
  });

  it('redacts Google API keys (AIza prefix)', () => {
    const t = 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456';
    expect(scrubCredentials(`google: ${t}`)).not.toContain(t);
  });

  it('redacts AWS access key IDs (AKIA prefix)', () => {
    const t = 'AKIAIOSFODNN7EXAMPLE';
    expect(scrubCredentials(`AWS ${t}`)).not.toContain(t);
  });

  it('redacts Resend, SendGrid, and HuggingFace tokens', () => {
    const resend = 're_aBcDeFgHiJkLmNoPqRsTuV';
    const sendgrid = 'SG.aBcDeFgHiJkLmNoPqRsTu.aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aBcDe';
    const hf = 'hf_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';
    expect(scrubCredentials(`r ${resend}`)).not.toContain(resend);
    expect(scrubCredentials(`s ${sendgrid}`)).not.toContain(sendgrid);
    expect(scrubCredentials(`h ${hf}`)).not.toContain(hf);
  });
});

describe('scrubCredentials — env-var line shape', () => {
  it('redacts KEY=VALUE on its own line, preserving the key', () => {
    const input = 'TWILIO_AUTH_TOKEN=abcdef0123456789abcdef0123456789';
    const out = scrubCredentials(input);
    expect(out).toBe('TWILIO_AUTH_TOKEN=[REDACTED]');
  });

  it('handles indented env-var lines and multi-line .env paste', () => {
    const input = [
      'SLACK_BOT_TOKEN=xoxb-EXAMPLE-EXAMPLEEXAMPLEEXAMPLE',
      '  TWILIO_AUTH_TOKEN=abcdef0123456789abcdef0123456789',
      'OPENAI_API_KEY=sk-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aB',
    ].join('\n');
    const out = scrubCredentials(input);
    expect(out).not.toContain('xoxb-EXAMPLE');
    expect(out).not.toContain('abcdef0123456789abcdef0123456789');
    expect(out).not.toContain('sk-aBcDeFgHiJkLmNoPqRsTuV');
    expect(out).toContain('SLACK_BOT_TOKEN=');
    expect(out).toContain('TWILIO_AUTH_TOKEN=');
    expect(out).toContain('OPENAI_API_KEY=');
    expect(out.split('[REDACTED]').length - 1).toBeGreaterThanOrEqual(3);
  });

  it('does not match KEY=VALUE mid-prose (line-anchored)', () => {
    // No anchor → not an env-var line. The token regex still wouldn't
    // match a 16-char alpha string, so we expect the input to pass
    // through unchanged.
    const input = 'set FOO=somevaluethatislong16 in the shell';
    expect(scrubCredentials(input)).toBe(input);
  });
});

describe('scrubCredentials — passthrough', () => {
  it('returns plain text unchanged', () => {
    const input = 'Connect Slack via OAuth and pick a channel.';
    expect(scrubCredentials(input)).toBe(input);
  });

  it('handles empty + non-string input', () => {
    expect(scrubCredentials('')).toBe('');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- defensive type guard test
    expect(scrubCredentials(null as any)).toBe(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- defensive type guard test
    expect(scrubCredentials(undefined as any)).toBe(undefined);
  });

  it('does not chew arbitrary base64-ish strings without recognized prefix', () => {
    const input = 'commit hash abcdef0123456789deadbeef0123456789cafef00d';
    expect(scrubCredentials(input)).toBe(input);
  });
});

describe('scrubMessagesForPersistence', () => {
  it('scrubs string content of user messages', () => {
    const messages = [
      {role: 'user', content: 'my key is sk_live_abcdef0123456789ABCDEF, keep secret'},
    ];
    const out = scrubMessagesForPersistence(messages);
    const first = out[0] as {role: string; content: string};
    expect(first.role).toBe('user');
    expect(first.content).toContain('[REDACTED]');
    expect(first.content).not.toContain('sk_live_');
  });

  it('scrubs text parts inside structured user content', () => {
    const messages = [
      {
        role: 'user',
        content: [
          {type: 'text', text: 'before sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890 after'},
          {type: 'image', image: 'data:...', mediaType: 'image/png'},
        ],
      },
    ];
    const out = scrubMessagesForPersistence(messages);
    const parts = (out[0] as {content: Array<Record<string, unknown>>}).content;
    expect(parts[0]?.['text']).toContain('[REDACTED]');
    expect(parts[0]?.['text']).not.toContain('sk-ant-api03');
    // Image part untouched.
    expect(parts[1]).toEqual({type: 'image', image: 'data:...', mediaType: 'image/png'});
  });

  it('does not scrub assistant or tool messages', () => {
    const assistantText = 'API key format is sk_live_abcdef0123456789ABCDEF';
    const messages = [
      {role: 'assistant', content: assistantText},
      {role: 'tool', content: [{type: 'tool-result', toolName: 'foo', output: 'sk_live_abcdef0123456789ABCDEF'}]},
    ];
    const out = scrubMessagesForPersistence(messages);
    expect((out[0] as {content: string}).content).toBe(assistantText);
    // Tool message passes through unchanged.
    expect(out[1]).toEqual(messages[1]);
  });

  it('passes through non-object entries unchanged', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape-tolerant input check
    const messages: any[] = ['unexpected string', 42, null];
    const out = scrubMessagesForPersistence(messages);
    expect(out).toEqual(messages);
  });

  it('no-leakage guarantee: every recognized pattern is gone from persisted form', () => {
    const known = [
      'xoxb-EXAMPLE-EXAMPLE-EXAMPLEEXAMPLEEXAMPLE',
      'sk_live_abcdef0123456789ABCDEF',
      'sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890',
      'sk-proj-aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789aB',
      'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789',
      'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456',
      'AKIAIOSFODNN7EXAMPLE',
      'hf_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345',
    ];
    const blob = `please ignore: ${known.join(' and ')}`;
    const out = scrubMessagesForPersistence([{role: 'user', content: blob}]);
    const persisted = JSON.stringify(out);
    for (const t of known) {
      expect(persisted).not.toContain(t);
    }
  });
});
