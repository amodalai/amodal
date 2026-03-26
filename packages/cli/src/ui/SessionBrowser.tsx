/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {useState, useEffect} from 'react';
import {Box, Text, useInput} from 'ink';
import http from 'node:http';
import https from 'node:https';
import {theme} from './theme.js';

export interface SessionEntry {
  id: string;
  createdAt: string;
  messageCount: number;
  preview: string;
}

interface SessionBrowserProps {
  baseUrl: string;
  onSelect: (sessionId: string) => void;
  onClose: () => void;
}

export const SessionBrowser: React.FC<SessionBrowserProps> = ({
  baseUrl,
  onSelect,
  onClose,
}) => {
  const [sessions, setSessions] = useState<SessionEntry[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const url = new URL('/sessions', baseUrl);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      { method: 'GET' },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
            const parsed = JSON.parse(data) as {sessions: SessionEntry[]};
            setSessions(parsed.sessions);
          } catch {
            setError('Failed to load sessions');
          } finally {
            setLoading(false);
          }
        });
      },
    );
    req.on('error', (err) => {
      setError(err.message);
      setLoading(false);
    });
    req.end();
  }, [baseUrl]);

  const filtered = filter
    ? sessions.filter(
        (s) =>
          s.id.includes(filter) || s.preview.toLowerCase().includes(filter.toLowerCase()),
      )
    : sessions;

  useInput((input, key) => {
    if (isSearching) {
      if (key.escape) {
        setIsSearching(false);
        setFilter('');
      } else if (key.return) {
        setIsSearching(false);
      } else if (key.backspace || key.delete) {
        setFilter((prev) => prev.slice(0, -1));
      } else if (input && !key.ctrl) {
        setFilter((prev) => prev + input);
      }
      return;
    }

    if (key.escape) {
      onClose();
    } else if (input === 'j' || key.downArrow) {
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
    } else if (input === 'k' || key.upArrow) {
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
    } else if (key.return) {
      const session = filtered[selectedIndex];
      if (session) {
        onSelect(session.id);
      }
    } else if (input === '/') {
      setIsSearching(true);
    }
  });

  if (loading) {
    return (
      <Box marginTop={1}>
        <Text color={theme.ui.dim}>Loading sessions...</Text>
      </Box>
    );
  }

  if (error) {
    return (
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.status.error}>Error: {error}</Text>
        <Text color={theme.ui.dim}>Press Esc to close</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Box marginBottom={1}>
        <Text bold color={theme.text.accent}>
          Sessions
        </Text>
        <Text color={theme.ui.dim}>
          {' '}({filtered.length} of {sessions.length})
        </Text>
      </Box>

      {isSearching ? (
        <Box marginBottom={1}>
          <Text color={theme.text.accent}>/ </Text>
          <Text>{filter}</Text>
          <Text color={theme.ui.dim}>_</Text>
        </Box>
      ) : filter ? (
        <Box marginBottom={1}>
          <Text color={theme.ui.dim}>filter: {filter}</Text>
        </Box>
      ) : null}

      {filtered.length === 0 ? (
        <Text color={theme.ui.dim}>No sessions found</Text>
      ) : (
        filtered.slice(0, 10).map((session, i) => {
          const isSelected = i === selectedIndex;
          return (
            <Box key={session.id} gap={1}>
              <Text color={isSelected ? theme.text.accent : theme.ui.dim}>
                {isSelected ? '>' : ' '}
              </Text>
              <Text bold={isSelected} color={isSelected ? theme.text.primary : theme.text.secondary}>
                {session.id.slice(0, 8)}
              </Text>
              <Text color={theme.ui.dim}>{session.createdAt}</Text>
              <Text color={theme.text.secondary} wrap="truncate-end">
                {session.preview}
              </Text>
            </Box>
          );
        })
      )}

      <Box marginTop={1} gap={2}>
        <Text color={theme.ui.dim}>j/k navigate</Text>
        <Text color={theme.ui.dim}>Enter select</Text>
        <Text color={theme.ui.dim}>/ search</Text>
        <Text color={theme.ui.dim}>Esc close</Text>
      </Box>
    </Box>
  );
};
