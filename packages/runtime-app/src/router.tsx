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
import { DevPage } from '@/pages/DevPage';

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
      { path: 'pages/:pageName', element: <DevPage /> },
    ],
  },
]);
