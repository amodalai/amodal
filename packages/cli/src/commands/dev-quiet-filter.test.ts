/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Phase 4 — protect dev-mode intent telemetry visibility.
 *
 * `passesQuietFilter` decides which subprocess stderr lines bubble up
 * to the user's terminal during `amodal dev`. The admin subprocess
 * runs with quiet=true (otherwise its INFO stream would drown out the
 * user's own log output), so this filter is the ONLY way Phase 4
 * telemetry events reach the user.
 *
 * The fixtures below are real log lines emitted by the runtime's
 * `formatText` formatter — pinning them ensures a format change in
 * @amodalai/core (e.g. switching to a new `[I]` short-prefix or
 * dropping the event-name prefix) trips this test before it ships and
 * silently breaks dev observability.
 */

import {describe, it, expect} from 'vitest';
import {passesQuietFilter, formatLineForDev} from './dev.js';

describe('passesQuietFilter — text-format log lines', () => {
  it('passes warnings and errors', () => {
    expect(passesQuietFilter('[WARN] something_bad {"foo":"bar"}')).toBe(true);
    expect(passesQuietFilter('[ERROR] db_connection_failed {"err":"timeout"}')).toBe(true);
    expect(passesQuietFilter('Error: ECONNREFUSED at ...')).toBe(true);
  });

  it('passes intent telemetry events (Phase 4)', () => {
    expect(
      passesQuietFilter(
        '[INFO] intent_matched {"intentId":"install-template","sessionId":"abc"}',
      ),
    ).toBe(true);
    expect(
      passesQuietFilter(
        '[INFO] intent_completed {"intentId":"install-template","sessionId":"abc","toolCount":4,"hasText":false,"durationMs":523}',
      ),
    ).toBe(true);
    expect(
      passesQuietFilter(
        '[INFO] intent_fell_through {"intentId":"looks-right","sessionId":"abc","durationMs":12}',
      ),
    ).toBe(true);
    expect(
      passesQuietFilter(
        '[WARN] intent_errored {"intentId":"crash","sessionId":"abc","error":"boom"}',
      ),
    ).toBe(true);
    expect(
      passesQuietFilter(
        '[WARN] intent_blocked_by_confirmation {"intentId":"x","sessionId":"abc","toolName":"y"}',
      ),
    ).toBe(true);
  });

  it('passes agent_loop_start so intent-vs-LLM ratio is countable', () => {
    expect(
      passesQuietFilter(
        '[INFO] agent_loop_start {"session":"abc","maxTurns":50,"messageCount":1}',
      ),
    ).toBe(true);
  });

  it('passes route_intent / route_llm markers (one per turn)', () => {
    expect(
      passesQuietFilter('[INFO] route_intent {"sessionId":"abc","intentId":"install-template"}'),
    ).toBe(true);
    expect(
      passesQuietFilter('[INFO] route_llm {"sessionId":"abc","reason":"no_intent_match"}'),
    ).toBe(true);
    expect(
      passesQuietFilter('[INFO] route_llm {"sessionId":"abc","reason":"intent_fell_through","intentId":"looks-right"}'),
    ).toBe(true);
  });

  it('filters out everything else (most INFO chatter)', () => {
    expect(passesQuietFilter('[INFO] session_created {"session":"abc"}')).toBe(false);
    expect(passesQuietFilter('[INFO] mcp_initialized {"servers":3}')).toBe(false);
    expect(passesQuietFilter('[DEBUG] tool_executing {"tool":"foo"}')).toBe(false);
    expect(passesQuietFilter('[INFO] agent_loop_done {"reason":"model_stop"}')).toBe(false);
    expect(passesQuietFilter('   plain stdout from a child process')).toBe(false);
    expect(passesQuietFilter('')).toBe(false);
  });
});

describe('passesQuietFilter — JSON-format log lines (LOG_FORMAT=json)', () => {
  it('passes intent telemetry events', () => {
    expect(
      passesQuietFilter(
        '{"level":"info","ts":"2026-05-03T18:00:00Z","event":"intent_matched","intentId":"install-template","sessionId":"abc"}',
      ),
    ).toBe(true);
    expect(
      passesQuietFilter(
        '{"level":"info","ts":"2026-05-03T18:00:00Z","event":"intent_completed","intentId":"install-template"}',
      ),
    ).toBe(true);
  });

  it('passes agent_loop_start', () => {
    expect(
      passesQuietFilter(
        '{"level":"info","ts":"2026-05-03T18:00:00Z","event":"agent_loop_start","session":"abc"}',
      ),
    ).toBe(true);
  });

  it('filters out non-telemetry JSON lines', () => {
    expect(
      passesQuietFilter(
        '{"level":"info","ts":"2026-05-03T18:00:00Z","event":"session_created","sessionId":"abc"}',
      ),
    ).toBe(false);
  });
});

describe('formatLineForDev — pretty-printing routing telemetry', () => {
  it('reformats route_intent as INTENT one-liner', () => {
    const line = '[INFO] route_intent {"sessionId":"abc","intentId":"install-template","userMessagePreview":"Set up template \'marketing-digest\'."}';
    expect(formatLineForDev(line)).toBe(
      '→ INTENT  install-template       "Set up template \'marketing-digest\'."',
    );
  });

  it('reformats route_llm with reason + detail', () => {
    expect(
      formatLineForDev(
        '[INFO] route_llm {"sessionId":"abc","reason":"intent_fell_through","intentId":"looks-right"}',
      ),
    ).toBe('→ LLM     intent_fell_through    "looks-right"');

    expect(
      formatLineForDev(
        '[INFO] route_llm {"sessionId":"abc","reason":"no_intent_match","userMessagePreview":"hello there"}',
      ),
    ).toBe('→ LLM     no_intent_match        "hello there"');
  });

  it('reformats intent_completed with tool count + duration', () => {
    expect(
      formatLineForDev(
        '[INFO] intent_completed {"intentId":"install-template","sessionId":"abc","toolCount":5,"hasText":false,"durationMs":10368}',
      ),
    ).toBe('  ✓ install-template done (5 tools, 10368ms)');
  });

  it('reformats intent_fell_through with duration', () => {
    expect(
      formatLineForDev(
        '[INFO] intent_fell_through {"intentId":"looks-right","sessionId":"abc","durationMs":12}',
      ),
    ).toBe('  ↓ looks-right fell through to LLM (12ms)');
  });

  it('reformats intent_errored with the error message', () => {
    expect(
      formatLineForDev(
        '[WARN] intent_errored {"intentId":"crash","sessionId":"abc","error":"boom","toolCallsStarted":0,"durationMs":3}',
      ),
    ).toBe('  ✗ crash ERRORED: boom');
  });

  it('suppresses intent_matched (redundant with route_intent)', () => {
    expect(
      formatLineForDev(
        '[INFO] intent_matched {"intentId":"install-template","sessionId":"abc"}',
      ),
    ).toBeNull();
  });

  it('suppresses agent_loop_start (route_llm already covers it)', () => {
    expect(
      formatLineForDev('[INFO] agent_loop_start {"session":"abc","maxTurns":50}'),
    ).toBeNull();
  });

  it('reformats tool_log as a nested bullet', () => {
    expect(
      formatLineForDev(
        '[INFO] tool_log {"callId":"intent_0f826d83","message":"Cloned whodatdev/template-marketing-operations-hub into agent repo (13 connection packages installed)","session":"pending"}',
      ),
    ).toBe(
      '    · Cloned whodatdev/template-marketing-operations-hub into agent repo (13 connection packages installed)',
    );
  });

  it('drops tool_log lines with no message', () => {
    expect(
      formatLineForDev('[INFO] tool_log {"callId":"intent_x","session":"abc"}'),
    ).toBeNull();
  });

  it('passes through non-routing lines unchanged', () => {
    expect(formatLineForDev('[ERROR] db_connection_failed {"err":"timeout"}')).toBe(
      '[ERROR] db_connection_failed {"err":"timeout"}',
    );
    expect(formatLineForDev('plain stdout from a child')).toBe('plain stdout from a child');
  });

  it('falls back to raw line on malformed JSON', () => {
    const line = '[INFO] route_intent {not valid json';
    expect(formatLineForDev(line)).toBe(line);
  });
});

