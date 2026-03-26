/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {useState, useCallback} from 'react';
import {Box, Text} from 'ink';
import TextInput from 'ink-text-input';
import {theme} from './theme.js';
import type {AskUserQuestion} from './types.js';

interface AskUserPromptProps {
  question: AskUserQuestion;
  onRespond: (askId: string, answer: string) => void;
}

export const AskUserPrompt: React.FC<AskUserPromptProps> = ({question, onRespond}) => {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      onRespond(question.askId, trimmed);
      setValue('');
    },
    [onRespond, question.askId],
  );

  return (
    <Box
      flexDirection="column"
      marginTop={1}
      borderStyle="round"
      borderColor={theme.text.accent}
      paddingLeft={1}
      paddingRight={1}
    >
      <Text color={theme.text.accent} bold>
        Agent Question
      </Text>
      <Text wrap="wrap">{question.text}</Text>
      <Box marginTop={1}>
        <Text color={theme.text.accent} bold>
          {'\u203A '}
        </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder="Type your answer..."
        />
      </Box>
    </Box>
  );
};
