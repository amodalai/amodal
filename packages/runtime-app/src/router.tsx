/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/layouts/AppShell';
import { ChatPage } from '@/pages/ChatPage';
import { SessionsPage } from '@/pages/SessionsPage';
import { SessionDetailPage } from '@/pages/SessionDetailPage';
import { EntityListPage } from '@/pages/EntityListPage';
import { EntityDetailPage } from '@/pages/EntityDetailPage';
import { AutomationsPage } from '@/pages/AutomationsPage';
import { AutomationDetailPage } from '@/pages/AutomationDetailPage';
import { DevPage } from '@/pages/DevPage';
import { InspectDetailPage } from '@/pages/InspectDetailPage';
import { ConfigLayout } from '@/pages/config/ConfigLayout';
import { ConfigOverviewPage } from '@/pages/config/ConfigOverviewPage';
import { ConfigPromptPage } from '@/pages/config/ConfigPromptPage';
import { ConfigSecretsPage } from '@/pages/config/ConfigSecretsPage';
import { ConfigFilesPage } from '@/pages/config/ConfigFilesPage';
import { EvalSuitePage } from '@/pages/EvalSuitePage';
import { ModelArenaPage } from '@/pages/ModelArenaPage';
import { FeedbackPage } from '@/pages/FeedbackPage';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: 'sessions', element: <SessionsPage /> },
      { path: 'sessions/:sessionId', element: <SessionDetailPage /> },
      { path: 'entities/:storeName', element: <EntityListPage /> },
      { path: 'entities/:storeName/:key', element: <EntityDetailPage /> },
      { path: 'automations', element: <AutomationsPage /> },
      { path: 'automations/:automationName', element: <AutomationDetailPage /> },
      { path: 'inspect/:kind/:name', element: <InspectDetailPage /> },
      { path: 'pages/:pageName', element: <DevPage /> },
    ],
  },
  {
    path: '/config',
    element: <ConfigLayout />,
    children: [
      { index: true, element: <ConfigOverviewPage /> },
      { path: 'prompt', element: <ConfigPromptPage /> },
      { path: 'secrets', element: <ConfigSecretsPage /> },
      { path: 'files', element: <ConfigFilesPage /> },
      { path: 'evals', element: <EvalSuitePage /> },
      { path: 'arena', element: <ModelArenaPage /> },
      { path: 'feedback', element: <FeedbackPage /> },
    ],
  },
]);
