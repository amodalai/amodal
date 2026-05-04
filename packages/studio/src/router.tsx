/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { StudioShell } from './components/StudioShell';
import { IndexPage } from './pages/IndexPage';
import { CreateFlowPage } from './pages/CreateFlowPage';
import { TemplateUpdatePage } from './pages/TemplateUpdatePage';
import { GettingStartedPage } from './pages/GettingStartedPage';
import { ConnectionConfigPage } from './pages/ConnectionConfigPage';
import { AgentPage } from './pages/AgentPage';
import { FilesPage } from './pages/FilesPage';
import { InspectPage } from './pages/InspectPage';
import { ModelsPage } from './pages/ModelsPage';
import { PromptPage } from './pages/PromptPage';
import { SecretsPage } from './pages/SecretsPage';
import { SystemPage } from './pages/SystemPage';
import { StoresPage } from './pages/StoresPage';
import { StoreDocumentsPage } from './pages/StoreDocumentsPage';
import { DocumentViewPage } from './pages/DocumentViewPage';
import { AutomationsPage } from './pages/AutomationsPage';
import { AutomationDetailPage } from './pages/AutomationDetailPage';
import { EvalsPage } from './pages/EvalsPage';
import { FeedbackPage } from './pages/FeedbackPage';
import { ArenaPage } from './pages/ArenaPage';
import { MemoryPage } from './pages/MemoryPage';
import { NotFoundPage } from './pages/NotFoundPage';

function Layout() {
  return (
    <StudioShell>
      <Outlet />
    </StudioShell>
  );
}

/** Agent-scoped routes — all Studio pages live under /agents/:agentId/ */
const agentRoutes = [
  { index: true, element: <IndexPage /> },
  // Onboarding chat lives at its own URL so the IndexPage probe at
  // `/agents/:agentId` can't auto-flip to OverviewPage mid-setup.
  // IndexPage redirects here when amodal.json is missing or the
  // setup_state row is still in flight; AdminChat's setup_completed
  // handler navigates back to the agent root once commit lands.
  { path: 'setup', element: <CreateFlowPage /> },
  { path: 'updates/:slug', element: <TemplateUpdatePage /> },
  { path: 'getting-started', element: <GettingStartedPage /> },
  { path: 'connections/:packageName', element: <ConnectionConfigPage /> },
  { path: 'agent', element: <AgentPage /> },
  { path: 'files', element: <FilesPage /> },
  { path: 'stores', element: <StoresPage /> },
  { path: 'stores/:name', element: <StoreDocumentsPage /> },
  { path: 'stores/:name/:key', element: <DocumentViewPage /> },
  { path: 'automations', element: <AutomationsPage /> },
  { path: 'automations/:name', element: <AutomationDetailPage /> },
  { path: 'evals', element: <EvalsPage /> },
  { path: 'feedback', element: <FeedbackPage /> },
  { path: 'memory', element: <MemoryPage /> },
  { path: 'arena', element: <ArenaPage /> },
  { path: 'prompt', element: <PromptPage /> },
  { path: 'secrets', element: <SecretsPage /> },
  { path: 'models', element: <ModelsPage /> },
  { path: 'system', element: <SystemPage /> },
  { path: 'inspect/:kind/:name', element: <InspectPage /> },
  { path: '*', element: <NotFoundPage /> },
];

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      // Root redirects to the default local agent
      { path: '/', element: <Navigate to="/agents/local" replace /> },
      // Agent-scoped routes
      { path: '/agents/:agentId/*', children: agentRoutes },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
