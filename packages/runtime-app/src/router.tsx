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
import { ConfigAgentPage } from '@/pages/config/ConfigAgentPage';
import { ConfigModelsPage } from '@/pages/config/ConfigModelsPage';
import { ConfigPromptPage } from '@/pages/config/ConfigPromptPage';
import { ConfigSecretsPage } from '@/pages/config/ConfigSecretsPage';
import { ConfigSystemPage } from '@/pages/config/ConfigSystemPage';
import { ConfigFilesPage } from '@/pages/config/ConfigFilesPage';
import { ConfigChatPage } from '@/pages/config/ConfigChatPage';

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
      { index: true, element: <ConfigChatPage /> },
      { path: 'agent', element: <ConfigAgentPage /> },
      { path: 'models', element: <ConfigModelsPage /> },
      { path: 'prompt', element: <ConfigPromptPage /> },
      { path: 'secrets', element: <ConfigSecretsPage /> },
      { path: 'system', element: <ConfigSystemPage /> },
      { path: 'files', element: <ConfigFilesPage /> },
    ],
  },
]);
