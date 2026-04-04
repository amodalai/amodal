/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */
import { defineConfig } from 'vocs'

export default defineConfig({
  rootDir: '.',
  iconUrl: '/favicon.svg',
  logoUrl: {
    light: '/logo-light.svg',
    dark: '/logo-dark.svg',
  },
  title: 'Amodal',
  titleTemplate: '%s — Amodal',
  description:
    'Documentation for the Amodal Agent Runtime — build domain-specific AI agents from your repo.',
  font: {
    google: 'Inter',
    mono: {
      google: 'JetBrains Mono',
    },
  },
  theme: {
    accentColor: {
      light: '#1E40AF',
      dark: '#60A5FA',
    },
    colorScheme: 'system',
    variables: {
      color: {
        background: {
          light: '#ffffff',
          dark: '#0f172a',
        },
        backgroundDark: {
          light: '#f8fafc',
          dark: '#0c1322',
        },
      },
      fontSize: {
        root: '13px',
      },
      content: {
        horizontalPadding: '48px',
        verticalPadding: '80px',
      },
    },
  },
  banner: {
    content:
      'Amodal is in early access — [get started](/quickstart/introduction)',
    backgroundColor: '#1E40AF',
    textColor: '#ffffff',
    dismissable: true,
  },
  socials: [
    {
      icon: 'github',
      link: 'https://github.com/amodal-ai',
    },
  ],
  topNav: [
    { text: 'Docs', link: '/' },
    { text: 'Marketplace', link: 'https://www.amodalai.com/marketplace' },
  ],
  sidebar: [
    {
      text: 'Home',
      link: '/',
    },
    {
      text: 'Getting Started',
      items: [
        {
          text: 'Introduction',
          link: '/quickstart/introduction',
        },
        {
          text: 'Quick Start',
          link: '/quickstart/create-agent',
        },
        {
          text: 'Project Structure',
          link: '/quickstart/project-structure',
        },
      ],
    },
    {
      text: 'CLI',
      items: [
        {
          text: 'Overview',
          link: '/cli',
        },
        {
          text: 'init',
          link: '/cli/init',
        },
        {
          text: 'dev',
          link: '/cli/dev',
        },
        {
          text: 'chat',
          link: '/cli/chat',
        },
        {
          text: 'eval',
          link: '/cli/eval',
        },
        {
          text: 'connect & sync',
          link: '/cli/connect',
        },
      ],
    },
    {
      text: 'Agent Configuration',
      items: [
        {
          text: 'amodal.json',
          link: '/guide/config',
        },
        {
          text: 'Connections',
          link: '/guide/connections',
        },
        {
          text: 'Skills',
          link: '/guide/skills',
        },
        {
          text: 'Tools',
          link: '/guide/tools',
        },
        {
          text: 'Knowledge Base',
          link: '/guide/knowledge-base',
        },
        {
          text: 'Stores',
          link: '/guide/stores',
        },
        {
          text: 'Pages',
          link: '/guide/pages',
        },
        {
          text: 'Automations',
          link: '/guide/automations',
        },
        {
          text: 'Evals',
          link: '/guide/evals',
        },
        {
          text: 'Agents (Prompt Overrides)',
          link: '/guide/agents',
        },
        {
          text: 'MCP Servers',
          link: '/guide/mcp',
        },
        {
          text: 'Security & Guardrails',
          link: '/guide/security',
        },
        {
          text: 'Engineering Standards',
          link: '/guide/engineering-standards',
        },
      ],
    },
    {
      text: 'Providers',
      link: '/guide/providers',
    },
    {
      text: 'React SDK',
      items: [
        {
          text: 'Overview',
          link: '/sdk',
        },
        {
          text: '@amodalai/react',
          link: '/sdk/react',
        },
        {
          text: 'Chat Widget',
          link: '/sdk/chat-widget',
        },
      ],
    },
    {
      text: 'Learn',
      items: [
        {
          text: 'What is an agent?',
          link: '/learn/what-is-an-agent',
        },
        {
          text: 'FAQ',
          link: '/learn/faq',
        },
      ],
    },
    {
      text: 'Architecture',
      items: [
        {
          text: 'The Core Loop',
          link: '/learn/architecture/core-loop',
        },
        {
          text: 'State Machine',
          link: '/learn/architecture/state-machine',
        },
        {
          text: 'Agent Architecture',
          link: '/learn/architecture/agents',
        },
        {
          text: 'Context Management',
          link: '/learn/architecture/context',
        },
        {
          text: 'Architecture Decisions',
          link: '/learn/architecture/decisions',
        },
      ],
    },
    {
      text: 'Use Cases',
      link: 'https://www.amodalai.com/blog',
    },
    {
      text: 'Reference',
      items: [
        {
          text: 'Architecture Overview',
          link: '/reference/architecture',
        },
        {
          text: 'Runtime Server',
          link: '/reference/runtime',
        },
      ],
    },
  ],
  redirects: [
    {
      source: '/quickstart',
      destination: '/quickstart/introduction',
    },
    {
      source: '/guide',
      destination: '/quickstart/introduction',
    },
    {
      source: '/reference',
      destination: '/reference/architecture',
    },
    {
      source: '/learn',
      destination: '/learn/architecture/core-loop',
    },
  ],
})
