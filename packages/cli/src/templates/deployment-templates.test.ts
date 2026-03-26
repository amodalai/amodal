/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {generateDockerfile} from './dockerfile-template.js';
import {generateCompose} from './compose-template.js';
import {extractEnvVars} from './env-template.js';

describe('generateDockerfile', () => {
  it('should generate valid Dockerfile', () => {
    const content = generateDockerfile();
    expect(content).toContain('FROM node:20-slim AS builder');
    expect(content).toContain('FROM node:20-slim AS production');
    expect(content).toContain('EXPOSE 3847');
  });

  it('should include multi-stage build', () => {
    const content = generateDockerfile();
    expect(content).toContain('AS builder');
    expect(content).toContain('AS production');
    expect(content).toContain('COPY --from=builder');
  });

  it('should set NODE_ENV', () => {
    const content = generateDockerfile();
    expect(content).toContain('NODE_ENV=production');
  });
});

describe('generateCompose', () => {
  it('should use service name', () => {
    const content = generateCompose('my-agent');
    expect(content).toContain('my-agent:');
  });

  it('should sanitize special characters in service name', () => {
    const content = generateCompose('My Agent v2.0');
    expect(content).toContain('my-agent-v2-0:');
  });

  it('should include health check', () => {
    const content = generateCompose('test');
    expect(content).toContain('healthcheck:');
    expect(content).toContain('/health');
  });

  it('should reference .env.production', () => {
    const content = generateCompose('test');
    expect(content).toContain('.env.production');
  });

  it('should expose port 3847', () => {
    const content = generateCompose('test');
    expect(content).toContain('3847:3847');
  });
});

describe('extractEnvVars', () => {
  it('should extract env:VAR_NAME references', () => {
    const json = '{"key": "env:MY_API_KEY", "model": "env:MODEL_NAME"}';
    const vars = extractEnvVars(json);
    expect(vars).toEqual(['MODEL_NAME', 'MY_API_KEY']);
  });

  it('should deduplicate vars', () => {
    const json = '{"a": "env:MY_KEY", "b": "env:MY_KEY"}';
    const vars = extractEnvVars(json);
    expect(vars).toEqual(['MY_KEY']);
  });

  it('should return empty for no env refs', () => {
    const json = '{"key": "literal-value"}';
    expect(extractEnvVars(json)).toEqual([]);
  });

  it('should handle complex nested JSON', () => {
    const json = JSON.stringify({
      models: {
        main: {provider: 'env:PROVIDER', model: 'env:MODEL'},
      },
      platform: {apiKey: 'env:API_KEY'},
    });
    const vars = extractEnvVars(json);
    expect(vars).toEqual(['API_KEY', 'MODEL', 'PROVIDER']);
  });

  it('should sort results alphabetically', () => {
    const json = '{"z": "env:ZEBRA", "a": "env:ALPHA"}';
    const vars = extractEnvVars(json);
    expect(vars).toEqual(['ALPHA', 'ZEBRA']);
  });

  it('should handle empty string', () => {
    expect(extractEnvVars('')).toEqual([]);
  });
});
