/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {Router} from 'express';
import type {Request, Response} from 'express';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {SessionManager} from '../../session/session-manager.js';
import {streamMessage} from '../../session/session-runner.js';
import {SSEEventType} from '../../types.js';
import type {SSEEvent} from '../../types.js';

export interface TaskRouterOptions {
  sessionManager: SessionManager;
}

const TaskRequestSchema = z.object({
  prompt: z.string().min(1),
  app_id: z.string().min(1),
  app_token: z.string().optional(),
});

interface TaskRecord {
  id: string;
  status: 'running' | 'completed' | 'error';
  events: SSEEvent[];
  createdAt: number;
}

const tasks = new Map<string, TaskRecord>();

export function createTaskRouter(options: TaskRouterOptions): Router {
  const router = Router();

  // POST /task — fire-and-forget task
  router.post('/task', async (req: Request, res: Response) => {
    const parsed = TaskRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({error: {code: 'VALIDATION_ERROR', message: parsed.error.message}});
      return;
    }

    const {prompt, app_id} = parsed.data;
    const taskId = randomUUID();

    const record: TaskRecord = {
      id: taskId,
      status: 'running',
      events: [],
      createdAt: Date.now(),
    };
    tasks.set(taskId, record);

    // Return task ID immediately
    res.status(202).json({task_id: taskId});

    // Run in background
    void (async () => {
      try {
        const session = await options.sessionManager.create(app_id);
        const controller = new AbortController();

        for await (const event of streamMessage(session, prompt, controller.signal)) {
          record.events.push(event);
        }

        record.status = 'completed';
      } catch (err) {
        record.status = 'error';
        const errMsg = err instanceof Error ? err.message : String(err);
        record.events.push({type: SSEEventType.Error, message: errMsg, timestamp: new Date().toISOString()});
      }
    })();
  });

  // GET /task/:id — poll task status
  router.get('/task/:id', (req: Request, res: Response) => {
    const taskId = req.params['id'];
    if (!taskId) {
      res.status(400).json({error: {code: 'MISSING_ID', message: 'Task ID required'}});
      return;
    }

    const record = tasks.get(taskId);
    if (!record) {
      res.status(404).json({error: {code: 'NOT_FOUND', message: 'Task not found'}});
      return;
    }

    res.json({
      task_id: record.id,
      status: record.status,
      event_count: record.events.length,
      created_at: record.createdAt,
    });
  });

  // GET /task/:id/stream — stream task events
  router.get('/task/:id/stream', (req: Request, res: Response) => {
    const taskId = req.params['id'];
    if (!taskId) {
      res.status(400).json({error: {code: 'MISSING_ID', message: 'Task ID required'}});
      return;
    }

    const record = tasks.get(taskId);
    if (!record) {
      res.status(404).json({error: {code: 'NOT_FOUND', message: 'Task not found'}});
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Send all existing events
    for (const event of record.events) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    if (record.status !== 'running') {
      res.end();
      return;
    }

    // Poll for new events
    let lastSent = record.events.length;
    const interval = setInterval(() => {
      while (lastSent < record.events.length) {
        res.write(`data: ${JSON.stringify(record.events[lastSent])}\n\n`);
        lastSent++;
      }

      if (record.status !== 'running') {
        clearInterval(interval);
        res.end();
      }
    }, 100);

    req.on('close', () => {
      clearInterval(interval);
    });
  });

  return router;
}
