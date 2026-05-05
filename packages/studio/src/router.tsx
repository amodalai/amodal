/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import { createBrowserRouter, Navigate, Outlet } from 'react-router-dom';
import { getBasePath } from './lib/api';
import { StudioShell } from './components/StudioShell';
import { IndexPage } from './pages/IndexPage';
import { CreateFlowPage } from './pages/CreateFlowPage';
import { TemplateUpdatePage } from './pages/TemplateUpdatePage';
import { SessionsPage } from './pages/SessionsPage';
import { SessionDetailPage } from './pages/SessionDetailPage';
import { ConnectionsPage } from './pages/ConnectionsPage';
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
import { CostPage } from './pages/CostPage';
import { NotFoundPage } from './pages/NotFoundPage';
import {
  AGENT_PATH,
  agentRoutePattern,
  ARENA_PATH,
  AUTOMATIONS_PATH,
  CONNECTIONS_PATH,
  COST_PATH,
  EVALS_PATH,
  FEEDBACK_PATH,
  FILES_PATH,
  INSPECT_PATH,
  MEMORY_PATH,
  MODELS_PATH,
  NOT_FOUND_PATH,
  PROMPT_PATH,
  ROOT_PATH,
  SECRETS_PATH,
  SESSIONS_PATH,
  SETUP_PATH,
  STORES_PATH,
  SYSTEM_PATH,
  UPDATES_PATH,
  defaultAgentPath,
} from './lib/routes';

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
  { path: SETUP_PATH, element: <CreateFlowPage /> },
  { path: `${UPDATES_PATH}/:slug`, element: <TemplateUpdatePage /> },
  { path: CONNECTIONS_PATH, element: <ConnectionsPage /> },
  { path: `${CONNECTIONS_PATH}/:packageName`, element: <ConnectionConfigPage /> },
  { path: SESSIONS_PATH, element: <SessionsPage /> },
  { path: `${SESSIONS_PATH}/:sessionId`, element: <SessionDetailPage /> },
  { path: COST_PATH, element: <CostPage /> },
  { path: AGENT_PATH, element: <AgentPage /> },
  { path: FILES_PATH, element: <FilesPage /> },
  { path: STORES_PATH, element: <StoresPage /> },
  { path: `${STORES_PATH}/:name`, element: <StoreDocumentsPage /> },
  { path: `${STORES_PATH}/:name/:key`, element: <DocumentViewPage /> },
  { path: AUTOMATIONS_PATH, element: <AutomationsPage /> },
  { path: `${AUTOMATIONS_PATH}/:name`, element: <AutomationDetailPage /> },
  { path: EVALS_PATH, element: <EvalsPage /> },
  { path: FEEDBACK_PATH, element: <FeedbackPage /> },
  { path: MEMORY_PATH, element: <MemoryPage /> },
  { path: ARENA_PATH, element: <ArenaPage /> },
  { path: PROMPT_PATH, element: <PromptPage /> },
  { path: SECRETS_PATH, element: <SecretsPage /> },
  { path: MODELS_PATH, element: <ModelsPage /> },
  { path: SYSTEM_PATH, element: <SystemPage /> },
  { path: `${INSPECT_PATH}/:kind/:name`, element: <InspectPage /> },
  { path: NOT_FOUND_PATH, element: <NotFoundPage /> },
];

export const router = createBrowserRouter(
  [
    {
      element: <Layout />,
      children: [
        { path: ROOT_PATH, element: <Navigate to={defaultAgentPath()} replace /> },
        { path: agentRoutePattern(), children: agentRoutes },
        { path: NOT_FOUND_PATH, element: <NotFoundPage /> },
      ],
    },
  ],
  { basename: getBasePath() || undefined },
);
