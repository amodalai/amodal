/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/layouts/AppShell';
import { ChatPage } from '@/pages/ChatPage';
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
      { path: 'entities/:storeName', element: <EntityListPage /> },
      { path: 'entities/:storeName/:key', element: <EntityDetailPage /> },
      { path: 'automations', element: <AutomationsPage /> },
      { path: 'pages/:pageName', element: <DevPage /> },
    ],
  },
]);
