/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, expect, it} from 'vitest';

import {PackageError} from './package-error.js';
import {parseJsonImport, parseMarkdownFrontmatter, validateSurfaceFrontmatter} from './frontmatter.js';

describe('parseMarkdownFrontmatter', () => {
  it('parses valid frontmatter', () => {
    const content = '---\nimport: salesforce\nonly:\n  - GET /foo\n---\nBody here.';
    const result = parseMarkdownFrontmatter(content);
    expect(result.frontmatter).toEqual({import: 'salesforce', only: ['GET /foo']});
    expect(result.body).toBe('Body here.');
  });

  it('returns null frontmatter when no frontmatter present', () => {
    const content = 'Just a body.\nNo frontmatter.';
    const result = parseMarkdownFrontmatter(content);
    expect(result.frontmatter).toBeNull();
    expect(result.body).toBe(content);
  });

  it('handles empty frontmatter block', () => {
    const content = '---\n\n---\nBody after empty.';
    const result = parseMarkdownFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('Body after empty.');
  });

  it('throws on malformed YAML', () => {
    const content = '---\n: invalid: yaml: {{{\n---\nBody';
    expect(() => parseMarkdownFrontmatter(content)).toThrow(PackageError);
  });

  it('throws on non-object frontmatter', () => {
    const content = '---\n- just a list\n- not a map\n---\nBody';
    expect(() => parseMarkdownFrontmatter(content)).toThrow(PackageError);
  });

  it('handles windows line endings', () => {
    const content = '---\r\nimport: test\r\n---\r\nBody with CRLF.';
    const result = parseMarkdownFrontmatter(content);
    expect(result.frontmatter).toEqual({import: 'test'});
    expect(result.body).toBe('Body with CRLF.');
  });

  it('handles frontmatter with no body', () => {
    const content = '---\nkey: value\n---';
    const result = parseMarkdownFrontmatter(content);
    expect(result.frontmatter).toEqual({key: 'value'});
    expect(result.body).toBe('');
  });

  it('handles YAML with null value', () => {
    const content = '---\n~\n---\nBody';
    const result = parseMarkdownFrontmatter(content);
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('Body');
  });

  it('handles multiple dashes in body content without confusing parser', () => {
    const content = '---\nimport: x\n---\nSome body\n---\nMore body after separator';
    const result = parseMarkdownFrontmatter(content);
    expect(result.frontmatter).toEqual({import: 'x'});
    expect(result.body).toContain('Some body');
  });
});

describe('parseJsonImport', () => {
  it('extracts import key and data', () => {
    const json = '{"import": "salesforce", "auth": {"type": "bearer"}}';
    const result = parseJsonImport(json);
    expect(result.import).toBe('salesforce');
    expect(result.data).toEqual({auth: {type: 'bearer'}});
  });

  it('returns undefined import when not present', () => {
    const json = '{"auth": {"type": "bearer"}}';
    const result = parseJsonImport(json);
    expect(result.import).toBeUndefined();
    expect(result.data).toEqual({auth: {type: 'bearer'}});
  });

  it('throws on invalid JSON', () => {
    expect(() => parseJsonImport('not json')).toThrow(PackageError);
  });

  it('throws on non-object JSON', () => {
    expect(() => parseJsonImport('[1, 2, 3]')).toThrow(PackageError);
  });

  it('handles empty object', () => {
    const result = parseJsonImport('{}');
    expect(result.import).toBeUndefined();
    expect(result.data).toEqual({});
  });

  it('handles JSON with only import key', () => {
    const result = parseJsonImport('{"import": "test"}');
    expect(result.import).toBe('test');
    expect(result.data).toEqual({});
  });
});

describe('validateSurfaceFrontmatter', () => {
  it('allows only', () => {
    expect(() => validateSurfaceFrontmatter({only: ['GET /foo']})).not.toThrow();
  });

  it('allows exclude', () => {
    expect(() => validateSurfaceFrontmatter({exclude: ['GET /foo']})).not.toThrow();
  });

  it('allows neither', () => {
    expect(() => validateSurfaceFrontmatter({import: 'test'})).not.toThrow();
  });

  it('throws on both only and exclude', () => {
    expect(() =>
      validateSurfaceFrontmatter({only: ['GET /foo'], exclude: ['GET /bar']}),
    ).toThrow(PackageError);
  });

  it('allows empty arrays without throwing', () => {
    expect(() =>
      validateSurfaceFrontmatter({only: [], exclude: []}),
    ).not.toThrow();
  });
});
