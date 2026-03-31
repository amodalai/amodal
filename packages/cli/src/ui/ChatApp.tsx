/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type React from 'react';
import {useCallback, useEffect} from 'react';
import {Box, Text, useApp, useInput, useStdout} from 'ink';
import {useChat} from './useChat.js';
import {ScrollableMessageList} from './ScrollableMessageList.js';
import {InputBar} from './InputBar.js';
import {Header} from './Header.js';
import {Footer} from './Footer.js';
import {NotificationBar} from './NotificationBar.js';
import {AskUserPrompt} from './AskUserPrompt.js';
import {ConfirmationPrompt} from './ConfirmationPrompt.js';
import {StatusMessage} from './StatusMessage.js';
import {SessionBrowser} from './SessionBrowser.js';
import {FullScreenLayout} from './FullScreenLayout.js';
import {theme} from './theme.js';
import {useScroll} from './useScroll.js';
import {useElapsedTime} from './useElapsedTime.js';
import {useSessionResume} from './useSessionResume.js';
import {getResponsiveLayout} from './useResponsiveLayout.js';
import {getCommand} from './commands/index.js';

interface ChatAppProps {
  baseUrl: string;
  appId: string;
  resumeSessionId?: string;
  fullscreen?: boolean;
}

// Approximate row counts for layout calculation
const HEADER_ROWS = 2;
const FOOTER_ROWS = 3;
const INPUT_ROWS = 2;

export const ChatApp: React.FC<ChatAppProps> = ({
  baseUrl,
  appId,
  resumeSessionId,
  fullscreen,
}) => {
  const {state, sendMessage, respondToQuestion, respondToConfirmation, dismissNotification, dispatch} =
    useChat(baseUrl, appId);
  const {exit} = useApp();
  const {stdout} = useStdout();
  const width = stdout?.columns ?? 80;
  const rows = stdout?.rows ?? 24;

  const layout = getResponsiveLayout(width);
  const elapsed = useElapsedTime(state.isStreaming);

  // Scroll management
  const viewportHeight = Math.max(rows - HEADER_ROWS - FOOTER_ROWS - INPUT_ROWS, 5);
  const scroll = useScroll(true);

  // Update viewport height
  useEffect(() => {
    scroll.setViewportHeight(viewportHeight);
  }, [viewportHeight, scroll]);

  // Auto-scroll when messages or streaming content changes
  useEffect(() => {
    // Estimate content height as number of messages * ~3 lines each + streaming
    const estimatedHeight = state.messages.length * 3 +
      (state.isStreaming ? 5 : 0) +
      state.activeToolCalls.length * 4;
    scroll.setContentHeight(estimatedHeight);
  }, [state.messages.length, state.isStreaming, state.activeToolCalls.length, scroll]);

  // Session resume
  const resume = useSessionResume(resumeSessionId ?? null, baseUrl);
  useEffect(() => {
    if (resume.messages && resumeSessionId) {
      dispatch({
        type: 'RESUME_SESSION',
        sessionId: resumeSessionId,
        messages: resume.messages,
      });
    }
  }, [resume.messages, resumeSessionId, dispatch]);

  // Ctrl+C always active — exits the app
  useInput((_input, key) => {
    if (key.ctrl && _input === 'c') {
      exit();
    }
  });

  // Scroll keybindings — only active when input bar is NOT showing
  // (i.e., during streaming, prompts, or session browser)
  const isInputBarVisible = !state.isStreaming && !state.pendingQuestion && !state.pendingConfirmation && !state.showSessionBrowser;
  useInput((_input, key) => {
    // j/k line scroll
    if (_input === 'j') {
      scroll.scrollBy(1);
    } else if (_input === 'k') {
      scroll.scrollBy(-1);
    }

    // Page up/down
    if (key.pageUp) {
      scroll.scrollBy(-viewportHeight);
    } else if (key.pageDown) {
      scroll.scrollBy(viewportHeight);
    }

    // Home/End
    if (key.home) {
      scroll.scrollToTop();
    } else if (key.end) {
      scroll.scrollToBottom();
    }
  }, {isActive: !isInputBarVisible});

  // Slash command handler
  const handleSlashCommand = useCallback(
    (name: string, args: string) => {
      const cmd = getCommand(name);
      if (!cmd) {
        dispatch({type: 'LOCAL_MESSAGE', text: `Unknown command: /${name}. Type /help for available commands.`});
        return;
      }
      const result = cmd.execute(args, state);
      switch (result.type) {
        case 'message':
          dispatch({type: 'LOCAL_MESSAGE', text: result.text ?? ''});
          break;
        case 'clear':
          dispatch({type: 'CLEAR_HISTORY'});
          break;
        case 'noop':
          break;
        default:
          break;
      }
    },
    [state, dispatch],
  );

  // Confirmation queue handlers
  const handleApproveAll = useCallback(() => {
    for (let i = 0; i < state.confirmationQueue.length; i++) {
      respondToConfirmation(true);
    }
  }, [state.confirmationQueue.length, respondToConfirmation]);

  const handleRejectAll = useCallback(() => {
    for (let i = 0; i < state.confirmationQueue.length; i++) {
      respondToConfirmation(false);
    }
  }, [state.confirmationQueue.length, respondToConfirmation]);

  // Session browser handlers
  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      dispatch({type: 'HIDE_SESSION_BROWSER'});
      // Trigger resume by re-mounting — for now just dispatch
      dispatch({type: 'LOCAL_MESSAGE', text: `Resuming session ${sessionId}...`});
    },
    [dispatch],
  );

  const handleSessionBrowserClose = useCallback(() => {
    dispatch({type: 'HIDE_SESSION_BROWSER'});
  }, [dispatch]);

  // Get first running tool name for InputBar
  const activeToolName = state.activeToolCalls.find((t) => t.status === 'running')?.toolName;
  const exploreQuery = state.explorePhase?.active ? state.explorePhase.query : undefined;
  const cwd = process.cwd();

  const currentConfirmation = state.confirmationQueue[0] ?? state.pendingConfirmation;

  const headerEl = (
    <Header sessionId={state.sessionId} isStreaming={state.isStreaming} isNarrow={layout.isNarrow} />
  );

  const footerEl = (
    <Footer
      isStreaming={state.isStreaming}
      hasPendingQuestion={!!state.pendingQuestion}
      hasPendingConfirmation={!!currentConfirmation}
      tokenUsage={state.tokenUsage}
      cwd={cwd}
      modelName={state.tokenUsage.model ?? undefined}
      isNarrow={layout.isNarrow}
    />
  );

  const content = (
    <>
      {/* Resume loading indicator */}
      {resume.loading ? (
        <Box marginBottom={1}>
          <StatusMessage type="info">Resuming session...</StatusMessage>
        </Box>
      ) : null}
      {resume.error ? (
        <Box marginBottom={1}>
          <StatusMessage type="error">Resume failed: {resume.error}</StatusMessage>
        </Box>
      ) : null}

      {/* Scrollable message viewport */}
      <ScrollableMessageList
        messages={state.messages}
        width={width}
        viewportHeight={viewportHeight}
        scrollTop={scroll.scrollTop}
        isStreaming={state.isStreaming}
        streamingText={state.streamingText}
        thinkingText={state.thinkingText}
        toolCalls={state.activeToolCalls}
        skills={state.activatedSkills}
        explore={state.explorePhase}
        error={state.error}
      />

      {/* Scroll position indicator */}
      {!scroll.isAtBottom && !state.isStreaming ? (
        <Box justifyContent="center">
          <Text color={theme.ui.dim}>{'\u2193'} more below</Text>
        </Box>
      ) : null}

      {/* Notifications */}
      <NotificationBar notifications={state.notifications} onDismiss={dismissNotification} />

      {/* Session Browser overlay */}
      {state.showSessionBrowser ? (
        <SessionBrowser
          baseUrl={baseUrl}
          onSelect={handleSessionSelect}
          onClose={handleSessionBrowserClose}
        />
      ) : null}

      {/* Input area — conditional on pending prompts */}
      {!state.showSessionBrowser ? (
        currentConfirmation ? (
          <ConfirmationPrompt
            request={currentConfirmation}
            queueSize={state.confirmationQueue.length}
            onRespond={respondToConfirmation}
            onApproveAll={handleApproveAll}
            onRejectAll={handleRejectAll}
          />
        ) : state.pendingQuestion ? (
          <AskUserPrompt question={state.pendingQuestion} onRespond={respondToQuestion} />
        ) : (
          <InputBar
            onSubmit={sendMessage}
            onSlashCommand={handleSlashCommand}
            isStreaming={state.isStreaming}
            elapsed={elapsed}
            exploreQuery={exploreQuery}
            activeToolName={activeToolName}
          />
        )
      ) : null}
    </>
  );

  if (fullscreen) {
    return (
      <FullScreenLayout header={headerEl} footer={footerEl}>
        {content}
      </FullScreenLayout>
    );
  }

  return (
    <Box flexDirection="column" width={width}>
      {headerEl}
      {content}
      {footerEl}
    </Box>
  );
};

