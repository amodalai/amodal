/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Regression: admin-chat route crashed with an unhandled DOMException
 * [AbortError] when the SSE client disconnected mid-stream.
 *
 * Root cause: `handleStreaming` in states/streaming.ts iterates
 * `state.stream.fullStream` via for-await. When ctx.signal aborts, the
 * provider's fetch rejects, `fullStream.next()` throws, and the for-await
 * propagates that throw BEFORE `await state.stream.text` runs. Without
 * passive handlers attached to the text/usage derived promises, their
 * rejection escapes as an unhandled rejection and crashes the process.
 *
 * The fix attaches `Promise.resolve(state.stream.text).catch(() => {})`
 * (and same for usage) at the top of handleStreaming.
 *
 * This test exercises the real SessionManager + runAgent + admin-chat
 * route path, disconnects the client mid-stream, and asserts no
 * unhandled rejection surfaces. It fails if the passive handlers are
 * removed from streaming.ts.
 */

import {describe, it, expect, beforeEach, afterEach} from 'vitest';
import express from 'express';
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {createAdminChatRouter} from './admin-chat.js';
import {StandaloneSessionManager} from '../../session/manager.js';
import {createLogger} from '../../logger.js';
import {createToolRegistry} from '../../tools/registry.js';
import type {SharedResources} from '../../routes/session-resolver.js';
import type {AgentBundle} from '@amodalai/types';
import type {LLMProvider, StreamTextResult} from '../../providers/types.js';

function makeBundle(): AgentBundle {
  return {
    source: 'local',
    origin: '/tmp/fake-repo',
    config: {name: 'test-agent', description: 'test'},
  } as unknown as AgentBundle;
}

function makeSharedResources(): SharedResources {
  return {
    storeBackend: {} as SharedResources['storeBackend'],
    mcpManager: {} as SharedResources['mcpManager'],
    logger: createLogger({component: 'test:shared'}),
    toolExecutor: {} as SharedResources['toolExecutor'],
    fieldScrubber: {} as SharedResources['fieldScrubber'],
  } as SharedResources;
}

/**
 * Provider whose streamText returns a StreamTextResult that mirrors the
 * AI SDK's contract: fullStream yields text chunks (respecting abortSignal),
 * and text/usage are derived promises that reject when fullStream throws.
 * This matches the production provider's behavior on abort.
 */
function abortAwareStreamingProvider(): LLMProvider {
  return {
    model: 'test-model',
    provider: 'test-provider',
    languageModel: {} as LLMProvider['languageModel'],
    streamText(opts: {abortSignal?: AbortSignal}): StreamTextResult {
      const signal = opts.abortSignal;
      let accumulated = '';
      let settleText!: (v: string) => void;
      let rejectText!: (e: unknown) => void;
      let settleUsage!: (u: {inputTokens: number; outputTokens: number; totalTokens: number}) => void;
      let rejectUsage!: (e: unknown) => void;

      const textPromise = new Promise<string>((res, rej) => {
        settleText = res;
        rejectText = rej;
      });
      const usagePromise = new Promise<{inputTokens: number; outputTokens: number; totalTokens: number}>((res, rej) => {
        settleUsage = res;
        rejectUsage = rej;
      });

      async function* innerStream() {
        for (let i = 0; i < 30; i++) {
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(resolve, 50);
            if (signal?.aborted) {
              clearTimeout(timer);
              reject(signal.reason);
              return;
            }
            signal?.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(signal.reason);
              },
              {once: true},
            );
          });
          const chunk = `chunk${String(i)} `;
          accumulated += chunk;
          yield {type: 'text-delta' as const, textDelta: chunk};
        }
        const usage = {inputTokens: 10, outputTokens: 5, totalTokens: 15};
        yield {type: 'finish' as const, usage};
        settleText(accumulated);
        settleUsage(usage);
      }

      const wrapped = (async function* () {
        try {
          for await (const ev of innerStream()) yield ev;
        } catch (e) {
          rejectText(e);
          rejectUsage(e);
          throw e;
        }
      })();

      return {
        fullStream: wrapped,
        textStream: (async function* () {})(),
        text: textPromise,
        usage: usagePromise,
        responseMessages: textPromise.then((t) => [{role: 'assistant' as const, content: t}]),
      };
    },
    generateText: () => Promise.reject(new Error('unused')),
  };
}

async function startServer(sm: StandaloneSessionManager): Promise<{port: number; close: () => Promise<void>}> {
  const app = express();
  app.use(express.json());
  app.use(
    createAdminChatRouter({
      sessionManager: sm,
      shared: makeSharedResources(),
      getBundle: () => makeBundle(),
      getPort: () => null,
    }),
  );

  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const {port} = server.address() as AddressInfo;
      resolve({
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** POST to /config/chat, read the first chunk, then destroy the client socket. */
async function postAndDisconnect(port: number, sessionId: string): Promise<void> {
  const body = JSON.stringify({message: 'test', session_id: sessionId});
  return new Promise<void>((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/config/chat',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        let bytesRead = 0;
        res.on('data', (chunk: Buffer) => {
          bytesRead += chunk.length;
          if (bytesRead >= 30) {
            req.destroy();
          }
        });
        res.on('close', () => resolve());
        res.on('error', () => resolve());
      },
    );
    req.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ECONNRESET') {
        resolve();
      } else {
        reject(err);
      }
    });
    req.write(body);
    req.end();
  });
}

describe('admin-chat route — client-disconnect abort handling', () => {
  let unhandled: unknown[];
  let handler: (err: unknown) => void;

  beforeEach(() => {
    unhandled = [];
    handler = (err: unknown) => unhandled.push(err);
    process.on('unhandledRejection', handler);
  });

  afterEach(() => {
    process.off('unhandledRejection', handler);
  });

  it('does not leak unhandled rejection when client disconnects mid-stream', async () => {
    const logger = createLogger({component: 'test:admin-chat-abort'});
    const sm = new StandaloneSessionManager({logger, ttlMs: 60_000});
    const session = sm.create({
      provider: abortAwareStreamingProvider(),
      toolRegistry: createToolRegistry(),
      permissionChecker: {check: () => ({allowed: true as const})},
      systemPrompt: 'test',
      appId: 'admin',
    });

    const server = await startServer(sm);
    try {
      await postAndDisconnect(server.port, session.id);
      await new Promise((r) => setTimeout(r, 500));
      expect(unhandled).toHaveLength(0);
    } finally {
      await server.close();
      await sm.shutdown();
    }
  });
});
