/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Stub catalog used as a fallback when the registry returns no agents.
 *
 * Lets the create-flow picker render real-looking cards on a fresh local
 * dev install (no registry running, no templates published). Each entry
 * also carries the rich detail (connections, skills, example output)
 * surfaced on the template detail page. Drop this file once the public
 * registry has enough featured templates that the picker will never see
 * an empty response in production.
 */

import type { CatalogAgent } from './useTemplateCatalog';

export const STUB_CATALOG_AGENTS: readonly CatalogAgent[] = [
  // ---------------- POPULAR / MARKETING ----------------
  {
    slug: 'marketing-digest',
    category: 'Marketing',
    tags: ['analytics', 'social', 'reporting'],
    githubRepo: 'whodatdev/template-marketing-operations-hub',
    defaultBranch: 'main',
    featured: true,
    card: {
      title: 'Monday Marketing Digest',
      tagline: 'Weekly metrics → Slack',
      uses: 4200,
      snippet:
        '📊 12.4k sessions (+8%)\n📱 2.1k impressions\n💰 ROAS 3.2x ✓\n⚠ IG engagement down 12%',
      platforms: ['Google Analytics', 'LinkedIn', 'Instagram', 'Slack'],
      thumbnailConversation: [
        {
          role: 'agent',
          content: 'Your weekly marketing digest is ready.\n\nWebsite: 12.4k sessions (+8%)\nLinkedIn: 2.1k impressions\nAd spend: $2,340 — ROAS 3.2x ✓',
        },
      ],
    },
    detail: {
      description:
        "Posts a metrics summary to your Slack channel every Monday morning. Pulls data from your analytics, social platforms, and ad accounts. Highlights what's working, what's not, and what needs attention.",
      preview: [
        {
          role: 'agent',
          text: 'Your weekly marketing digest is ready.\n\n📊 Website: 12.4k sessions (+8% WoW)\nTop page: /blog/why-we-switched (2.1k views)\n\n📱 Social\nLinkedIn: 3 posts, 2.1k impressions\nTop: "Why we switched to..." (847 clicks)\n\n💰 Ad Spend: $2,340 — ROAS 3.2x ✓\n\n⚠ Instagram engagement down 12%. Recommend refreshing creative this week.',
        },
        { role: 'user', text: 'Break this down by campaign.' },
        {
          role: 'agent',
          text: 'Campaign breakdown:\n• Brand awareness: $890, 45k impressions, CPC $0.42\n• Product launch: $1,450, ROAS 4.1x ← winner\n• Retargeting: paused (budget depleted Thu)',
        },
      ],
      connections: {
        required: [
          { name: 'Google Analytics', desc: 'Website traffic + conversions' },
          { name: 'Slack', desc: 'Digest delivery' },
        ],
        optional: [
          { name: 'LinkedIn', desc: 'Social post metrics' },
          { name: 'Instagram', desc: 'Social post metrics' },
          { name: 'X', desc: 'Social post metrics' },
          { name: 'Google Ads', desc: 'Ad spend + ROAS' },
          { name: 'Meta Ads', desc: 'Ad spend + ROAS' },
          { name: 'HubSpot', desc: 'CRM pipeline data' },
        ],
      },
      skills: [
        { name: 'Weekly digest', desc: 'Compiles and summarizes all metrics' },
        { name: 'Ad performance', desc: 'Breaks down spend by campaign' },
        { name: 'Trend alerts', desc: 'Flags significant week-over-week changes' },
      ],
      setup: {
        q: 'Which analytics platform do you use?',
        choices: ['Google Analytics', 'Adobe Analytics', 'Plausible', 'Other'],
      },
    },
  },

  {
    slug: 'support-triage',
    category: 'Support',
    tags: ['ticketing', 'routing'],
    githubRepo: 'amodalai/template-support-triage',
    defaultBranch: 'main',
    featured: true,
    card: {
      title: 'Support Triage Bot',
      tagline: 'Classify, route, auto-reply',
      uses: 2800,
      snippet:
        '🎫 #4821 "Can\'t export PDF"\nPriority: High\nRouted → Engineering\n✓ Auto-reply sent',
      platforms: ['Zendesk', 'Slack'],
      thumbnailConversation: [
        {
          role: 'agent',
          content: 'Ticket #4821 — "Can\'t export PDF"\n\nPriority: High\nCategory: Export\nRouted to: Engineering',
        },
      ],
    },
    detail: {
      description:
        'Automatically classifies incoming support tickets by priority and category, routes them to the right team, and drafts initial responses using your knowledge base.',
      preview: [
        {
          role: 'agent',
          text: '🎫 Ticket #4821 — "Can\'t export PDF"\n\nPriority: High (paying customer, 3rd ticket this month)\nCategory: Export / Integration\nRouted to: Engineering\n\nDraft reply sent:\n"Hi Sarah, I\'ve flagged this with our engineering team. In the meantime, you can export via Print → Save as PDF as a workaround."',
        },
        { role: 'user', text: "What's the ticket volume this week?" },
        {
          role: 'agent',
          text: 'This week: 47 tickets\n• 8 high priority (3 resolved)\n• 31 medium (24 resolved)\n• 8 low (all resolved)\n\nTop category: Billing questions (14 tickets)\nAvg first response: 4 minutes',
        },
      ],
      connections: {
        required: [{ name: 'Zendesk', desc: 'Incoming tickets + responses' }],
        optional: [
          { name: 'Slack', desc: 'Escalation alerts' },
          { name: 'Notion', desc: 'Knowledge base for reply drafting' },
          { name: 'Confluence', desc: 'Knowledge base for reply drafting' },
        ],
      },
      skills: [
        { name: 'Ticket triage', desc: 'Classify priority + category automatically' },
        { name: 'Smart routing', desc: 'Route to the right team based on rules' },
        { name: 'Reply drafting', desc: 'Draft responses from your knowledge base' },
      ],
      setup: {
        q: 'Where do your support tickets come in?',
        choices: ['Zendesk', 'Intercom', 'Freshdesk', 'Email'],
      },
    },
  },

  {
    slug: 'sales-pipeline',
    category: 'Sales',
    tags: ['crm', 'forecasting'],
    githubRepo: 'amodalai/template-sales-pipeline',
    defaultBranch: 'main',
    featured: true,
    card: {
      title: 'Sales Pipeline Update',
      tagline: 'Morning snapshot → Slack',
      uses: 3100,
      snippet:
        '📈 3 deals → Negotiation ($84k)\n🎉 Closed: Acme $32k ARR\n⚠ 2 stale >14 days',
      platforms: ['HubSpot', 'Slack'],
      thumbnailConversation: [
        {
          role: 'agent',
          content: '📈 Pipeline — Tue Apr 22\n\n3 deals moved to Negotiation ($84k total)\n1 deal closed: Acme Corp — $32k ARR 🎉',
        },
      ],
    },
    detail: {
      description:
        'Posts a morning pipeline snapshot to Slack. Shows new deals, closed deals, and flags stale opportunities that need follow-up.',
      preview: [
        {
          role: 'agent',
          text: '📈 Pipeline — Tue Apr 22\n\n3 deals moved to Negotiation ($84k total)\n1 deal closed: Acme Corp — $32k ARR 🎉\n\n⚠ 2 deals stale >14 days:\n• Initech — last contact 18 days ago\n• Globex — contract sent, no response (12d)',
        },
        { role: 'user', text: 'Draft a follow-up for Initech.' },
        {
          role: 'agent',
          text: '"Hi Mark, wanted to circle back on our proposal from a few weeks ago. We\'ve since added the custom reporting you asked about — happy to walk you through it. Do you have 15 minutes this week?"',
        },
      ],
      connections: {
        required: [
          { name: 'HubSpot', desc: 'Deal pipeline + contacts' },
          { name: 'Slack', desc: 'Pipeline delivery' },
        ],
        optional: [
          { name: 'Salesforce', desc: 'Alternative CRM' },
          { name: 'Gmail', desc: 'Send follow-ups directly' },
        ],
      },
      skills: [
        { name: 'Pipeline snapshot', desc: 'Morning summary of deal movement' },
        { name: 'Stale deal alerts', desc: 'Flags deals with no activity' },
        { name: 'Follow-up drafter', desc: 'Writes context-aware outreach' },
      ],
      setup: {
        q: 'Which CRM are you on?',
        choices: ['HubSpot', 'Salesforce', 'Pipedrive', 'Other'],
      },
    },
  },

  {
    slug: 'job-scheduler',
    category: 'Ops',
    tags: ['scheduling', 'reminders'],
    githubRepo: 'amodalai/template-job-scheduler',
    defaultBranch: 'main',
    featured: true,
    card: {
      title: 'Job Scheduler',
      tagline: 'Schedule jobs, text reminders',
      uses: 890,
      snippet:
        '📅 9AM Sarah — leaky faucet\n📅 1PM Mike — water heater\n📱 Reminders sent\n🕞 3:30 open',
      platforms: ['Twilio', 'Google Calendar'],
      thumbnailConversation: [
        {
          role: 'agent',
          content: '📅 Tomorrow\n\n9:00 AM  Sarah — leaky faucet\n1:00 PM  Mike — water heater\n📱 Reminders sent.',
        },
      ],
    },
    detail: {
      description:
        'Manages your daily job schedule. Add jobs by telling it the details. Sends text reminders to customers the day before their appointment.',
      preview: [
        {
          role: 'agent',
          text: '📅 Tomorrow — Wed Apr 29\n\n9:00 AM  Sarah Chen — 450 Oak St\n             Leaky faucet, kitchen\n1:00 PM  Mike Torres — 22 Elm Ave\n             Water heater install\n3:30 PM  Open — no jobs scheduled\n\n📱 Sent reminders to Sarah and Mike.',
        },
        { role: 'user', text: 'Add 3:30, Lisa Park, 88 Main, garbage disposal.' },
        {
          role: 'agent',
          text: '✓ Added. Lisa will get a reminder tomorrow at 7 AM.\n\n📅 Updated schedule:\n3:30 PM  Lisa Park — 88 Main St\n             Garbage disposal',
        },
      ],
      connections: {
        required: [{ name: 'Twilio', desc: 'SMS reminders to customers' }],
        optional: [
          { name: 'Google Calendar', desc: 'Sync with your calendar' },
          { name: 'QuickBooks', desc: 'Log completed jobs + charges' },
        ],
      },
      skills: [
        { name: 'Job scheduler', desc: 'Manage daily schedule via conversation' },
        { name: 'Appointment reminders', desc: 'Text customers the day before' },
        { name: 'Job logging', desc: 'Track completed work + charges' },
      ],
      setup: {
        q: 'How do your customers currently book?',
        choices: ['Phone', 'Text', 'Online form', 'Mix of everything'],
      },
    },
  },

  // ---------------- MARKETING (additional) ----------------
  {
    slug: 'content-calendar',
    category: 'Marketing',
    tags: ['content', 'editorial'],
    githubRepo: 'amodalai/template-content-calendar',
    defaultBranch: 'main',
    featured: false,
    card: {
      title: 'Content Calendar',
      tagline: 'Plan + queue posts',
      uses: 1900,
      snippet:
        '📝 3 posts queued this week\n✓ Mon: Product update\n✓ Wed: Customer story\n⏳ Fri: Newsletter draft',
      platforms: ['Notion', 'Buffer'],
      thumbnailConversation: [
        { role: 'agent', content: '📝 3 posts queued this week.' },
      ],
    },
    detail: {
      description: 'Plans the editorial calendar and queues posts across your channels.',
      preview: [
        {
          role: 'agent',
          text: '📝 This week\n\n✓ Mon: "Product update — v3.0" (LinkedIn)\n✓ Wed: Customer story — Acme (LinkedIn + X)\n⏳ Fri: Newsletter draft pending review',
        },
      ],
      connections: {
        required: [{ name: 'Notion', desc: 'Editorial pipeline' }],
        optional: [
          { name: 'Buffer', desc: 'Auto-publish queued posts' },
          { name: 'LinkedIn', desc: 'Direct publishing' },
        ],
      },
      skills: [
        { name: 'Editorial scheduling', desc: 'Builds the weekly calendar' },
        { name: 'Draft review', desc: 'Flags posts that need attention' },
      ],
      setup: { q: 'Where do you draft posts?', choices: ['Notion', 'Google Docs', 'Other'] },
    },
  },

  {
    slug: 'competitor-monitor',
    category: 'Marketing',
    tags: ['competitive', 'monitoring'],
    githubRepo: 'amodalai/template-competitor-monitor',
    defaultBranch: 'main',
    featured: false,
    card: {
      title: 'Competitor Monitor',
      tagline: 'Track competitor activity',
      uses: 920,
      snippet:
        '👀 Acme: 4 posts this week\nTop: "AI in logistics" (312 👍)\nGlobex: launched case study\n📊 Your share of voice: 34%',
      platforms: ['LinkedIn', 'Slack'],
      thumbnailConversation: [
        { role: 'agent', content: '👀 Competitor activity for the week...' },
      ],
    },
    detail: {
      description: 'Watches your competitors\' social channels and surfaces what they\'re shipping.',
      preview: [
        {
          role: 'agent',
          text: '👀 Competitor weekly\n\nAcme — 4 posts, top: "AI in logistics" (312 👍)\nGlobex — launched a case study series\n📊 Your share of voice: 34%',
        },
      ],
      connections: {
        required: [{ name: 'LinkedIn', desc: 'Public competitor posts' }],
        optional: [{ name: 'Slack', desc: 'Weekly digest' }],
      },
      skills: [
        { name: 'Competitor scrape', desc: 'Pulls public posts on a schedule' },
        { name: 'Share-of-voice', desc: 'Compares your reach against competitors' },
      ],
      setup: { q: 'How many competitors do you track?', choices: ['1-3', '4-6', '7+'] },
    },
  },

  // ---------------- SALES (additional) ----------------
  {
    slug: 'lead-qualifier',
    category: 'Sales',
    tags: ['leads', 'enrichment'],
    githubRepo: 'amodalai/template-lead-qualifier',
    defaultBranch: 'main',
    featured: false,
    card: {
      title: 'Lead Qualifier',
      tagline: 'Score + route inbound leads',
      uses: 1400,
      snippet:
        '🟢 High: sarah@acme.co\n   Score: 87 · Enterprise\n🟡 Med: mike@startup.io\n   Score: 54 · SMB',
      platforms: ['HubSpot', 'Clearbit'],
      thumbnailConversation: [
        { role: 'agent', content: '🟢 New high-scoring lead: sarah@acme.co (87)' },
      ],
    },
    detail: {
      description: 'Scores inbound leads using fit + intent and routes them to the right rep.',
      preview: [
        {
          role: 'agent',
          text: '🟢 New lead: sarah@acme.co\n\nFit score: 87 · Enterprise · 250+ employees\nIntent: visited /pricing 4x this week\nAssigned to: Jamie',
        },
      ],
      connections: {
        required: [{ name: 'HubSpot', desc: 'CRM + scoring engine' }],
        optional: [{ name: 'Clearbit', desc: 'Enrichment' }],
      },
      skills: [
        { name: 'Lead scoring', desc: 'Combines fit + intent into a single score' },
        { name: 'Round-robin routing', desc: 'Assigns by territory or capacity' },
      ],
      setup: { q: 'Where do leads come in?', choices: ['Website form', 'Calendly', 'Both'] },
    },
  },

  // ---------------- SUPPORT (additional) ----------------
  {
    slug: 'csat-digest',
    category: 'Support',
    tags: ['feedback', 'reporting'],
    githubRepo: 'amodalai/template-csat-digest',
    defaultBranch: 'main',
    featured: false,
    card: {
      title: 'CSAT Weekly Digest',
      tagline: 'Satisfaction trends → Slack',
      uses: 580,
      snippet:
        '😊 CSAT: 4.3 (▲ 0.2)\n📊 142 responses this week\n⚠ Billing: 3.1 avg (lowest)\n🌟 Onboarding: 4.8 (highest)',
      platforms: ['Zendesk', 'Slack'],
      thumbnailConversation: [
        { role: 'agent', content: '😊 CSAT: 4.3 this week (▲ 0.2)' },
      ],
    },
    detail: {
      description: 'Aggregates CSAT scores by category and posts a weekly trend to Slack.',
      preview: [
        {
          role: 'agent',
          text: '😊 CSAT — Week of Apr 22\n\n4.3 / 5 (▲ 0.2)\n142 responses\n\n⚠ Billing: 3.1 avg (lowest) — 4 detractor comments\n🌟 Onboarding: 4.8 avg (highest)',
        },
      ],
      connections: {
        required: [{ name: 'Zendesk', desc: 'Survey responses' }],
        optional: [{ name: 'Slack', desc: 'Weekly digest channel' }],
      },
      skills: [
        { name: 'CSAT aggregation', desc: 'Rolls up scores by category and tag' },
        { name: 'Detractor surfacing', desc: 'Flags comments below 3' },
      ],
      setup: { q: 'Which support tool do you use?', choices: ['Zendesk', 'Intercom', 'Other'] },
    },
  },

  // ---------------- OPS (additional) ----------------
  {
    slug: 'invoice-reminder',
    category: 'Ops',
    tags: ['finance', 'reminders'],
    githubRepo: 'amodalai/template-invoice-reminder',
    defaultBranch: 'main',
    featured: false,
    card: {
      title: 'Invoice Reminder',
      tagline: 'Chase overdue invoices',
      uses: 540,
      snippet:
        '💸 2 overdue invoices\n⚠ Acme: $4,200 (14d late)\n⚠ Globex: $1,800 (7d late)\n✉️ Reminder sent to Acme',
      platforms: ['QuickBooks', 'Gmail'],
      thumbnailConversation: [
        { role: 'agent', content: '💸 2 overdue invoices flagged.' },
      ],
    },
    detail: {
      description: 'Watches your invoicing tool for overdue invoices and sends polite reminders on a schedule.',
      preview: [
        {
          role: 'agent',
          text: '💸 Overdue this morning\n\n• Acme — $4,200 (14d late)\n• Globex — $1,800 (7d late)\n\n✉️ Reminder sent to Acme; Globex queued for tomorrow.',
        },
      ],
      connections: {
        required: [{ name: 'QuickBooks', desc: 'Invoice data' }],
        optional: [{ name: 'Gmail', desc: 'Send reminders' }],
      },
      skills: [
        { name: 'Overdue detection', desc: 'Daily sweep for late invoices' },
        { name: 'Reminder cadence', desc: 'Polite → firm escalation over time' },
      ],
      setup: { q: 'Which accounting tool do you use?', choices: ['QuickBooks', 'Xero', 'Wave', 'Other'] },
    },
  },
];
