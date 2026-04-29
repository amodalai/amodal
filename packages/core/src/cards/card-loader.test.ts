/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {describe, it, expect} from 'vitest';
import {parseAgentCardJson, parseAgentCardPreviewJson} from './card-loader.js';
import {RepoError} from '../repo/repo-types.js';

describe('parseAgentCardJson', () => {
  const validCard = {
    title: 'Monday Marketing Digest',
    tagline: 'Weekly metrics summary → Slack.',
    platforms: ['Google Analytics', 'LinkedIn', 'Slack'],
    thumbnailConversation: [
      {role: 'agent', content: 'Your weekly marketing digest is ready.'},
      {role: 'user', content: 'Break this down by campaign.'},
      {role: 'agent', content: "Here's your campaign breakdown..."},
    ],
  };

  it('parses a valid card', () => {
    const card = parseAgentCardJson(JSON.stringify(validCard), 'card.json');
    expect(card.title).toBe('Monday Marketing Digest');
    expect(card.platforms).toHaveLength(3);
    expect(card.thumbnailConversation).toHaveLength(3);
  });

  it('defaults platforms to []', () => {
    const {platforms: _, ...withoutPlatforms} = validCard;
    const card = parseAgentCardJson(JSON.stringify(withoutPlatforms), 'card.json');
    expect(card.platforms).toEqual([]);
  });

  it('throws CONFIG_PARSE_FAILED on malformed JSON', () => {
    expect(() => parseAgentCardJson('{not json', 'card.json')).toThrow(RepoError);
    try {
      parseAgentCardJson('{not json', 'card.json');
    } catch (err) {
      expect((err as RepoError).code).toBe('CONFIG_PARSE_FAILED');
    }
  });

  it('throws CONFIG_VALIDATION_FAILED when title is missing', () => {
    const {title: _, ...invalid} = validCard;
    try {
      parseAgentCardJson(JSON.stringify(invalid), 'card.json');
      expect.fail('expected to throw');
    } catch (err) {
      expect((err as RepoError).code).toBe('CONFIG_VALIDATION_FAILED');
    }
  });

  it('rejects an empty conversation', () => {
    const empty = {...validCard, thumbnailConversation: []};
    try {
      parseAgentCardJson(JSON.stringify(empty), 'card.json');
      expect.fail('expected to throw');
    } catch (err) {
      expect((err as RepoError).code).toBe('CONFIG_VALIDATION_FAILED');
    }
  });

  it('rejects unknown turn role', () => {
    const bad = {
      ...validCard,
      thumbnailConversation: [{role: 'system', content: 'hi'}],
    };
    try {
      parseAgentCardJson(JSON.stringify(bad), 'card.json');
      expect.fail('expected to throw');
    } catch (err) {
      expect((err as RepoError).code).toBe('CONFIG_VALIDATION_FAILED');
    }
  });
});

describe('parseAgentCardPreviewJson', () => {
  const validPreview = {
    title: 'Monday Marketing Digest',
    description: 'Posts a metrics summary to Slack every Monday.',
    platforms: ['Google Analytics', 'LinkedIn'],
    conversation: [
      {role: 'agent', content: 'Your weekly digest is ready...'},
      {role: 'user', content: 'Break this down by campaign.'},
      {role: 'agent', content: "Here's your campaign breakdown..."},
    ],
  };

  it('parses a valid preview', () => {
    const preview = parseAgentCardPreviewJson(JSON.stringify(validPreview), 'preview.json');
    expect(preview.title).toBe('Monday Marketing Digest');
    expect(preview.conversation).toHaveLength(3);
  });

  it('throws when description is missing', () => {
    const {description: _, ...invalid} = validPreview;
    try {
      parseAgentCardPreviewJson(JSON.stringify(invalid), 'preview.json');
      expect.fail('expected to throw');
    } catch (err) {
      expect((err as RepoError).code).toBe('CONFIG_VALIDATION_FAILED');
    }
  });
});
