/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {AgentBundle} from '../repo/repo-types.js';
import type {
  CompiledContext,
  ContextSection,
  SessionConfig,
} from './runtime-types.js';
import type {TokenAllocator} from './token-allocator.js';

/**
 * Compiles system prompts from repo configuration and session state.
 *
 * Builds ordered, prioritized context sections and delegates to TokenAllocator
 * for budget trimming.
 */
export class ContextCompiler {
  private readonly repo: AgentBundle;
  private readonly allocator: TokenAllocator;

  constructor(config: {repo: AgentBundle; allocator: TokenAllocator}) {
    this.repo = config.repo;
    this.allocator = config.allocator;
  }

  /**
   * Compile the full primary-agent system prompt.
   */
  compile(session: SessionConfig): CompiledContext {
    const sections: ContextSection[] = [];

    // 1. base_prompt (priority 10)
    const description = this.repo.config.description ?? '';
    const descLine = description ? `\n${description}\n` : '\n';
    sections.push(
      this.section(
        'base_prompt',
        `You are an AI assistant for ${this.repo.config.name}.${descLine}\nYou help users by querying connected systems, analyzing data, and taking actions when authorized.\nAlways use the request tool to interact with external systems. Never fabricate data.`,
        10,
      ),
    );

    // 2. agent_override (priority 9)
    if (this.repo.agents.main) {
      sections.push(this.section('agent_override', this.repo.agents.main, 9));
    }

    // 3. connections (priority 8)
    const connectionsContent = this.buildConnectionsContent();
    if (connectionsContent) {
      sections.push(this.section('connections', connectionsContent, 8));
    }

    // 4. skills (priority 7)
    const skillsContent = this.buildSkillsContent();
    if (skillsContent) {
      sections.push(this.section('skills', skillsContent, 7));
    }

    // 5. knowledge (priority 6)
    const knowledgeContent = this.buildKnowledgeContent();
    if (knowledgeContent) {
      sections.push(this.section('knowledge', knowledgeContent, 6));
    }

    // 6. field_guidance (priority 5)
    if (session.fieldGuidance) {
      sections.push(
        this.section(
          'field_guidance',
          `## Field Access Restrictions\n${session.fieldGuidance}`,
          5,
        ),
      );
    }

    // 7. scope_descriptions (priority 4)
    const scopeEntries = Object.entries(session.scopeLabels);
    if (scopeEntries.length > 0) {
      const lines = scopeEntries.map(
        ([entity, label]) => `- ${entity}: ${label}`,
      );
      sections.push(
        this.section(
          'scope_descriptions',
          `## Data Scope\n${lines.join('\n')}`,
          4,
        ),
      );
    }

    // 8. alternative_lookups (priority 3)
    if (session.alternativeLookupGuidance) {
      sections.push(
        this.section(
          'alternative_lookups',
          session.alternativeLookupGuidance,
          3,
        ),
      );
    }

    // 9. plan_mode (priority 10, never trimmed)
    if (session.planMode) {
      let planContent =
        '## Planning Mode Active\nYou are currently in planning mode. Present your plan to the user before executing write operations.\nRead operations and explore are allowed freely.';
      if (session.approvedPlan) {
        planContent += `\n\n## Approved Plan\nExecute the following approved plan:\n${session.approvedPlan}`;
      }
      sections.push(this.section('plan_mode', planContent, 10));
    }

    return this.buildResult(sections);
  }

  /**
   * Compile the explore sub-agent system prompt (subset of main).
   */
  compileExplore(session: SessionConfig): CompiledContext {
    const sections: ContextSection[] = [];

    // 1. base_prompt (priority 10) — explore-specific
    sections.push(
      this.section(
        'base_prompt',
        'You are a data-gathering sub-agent. Your job is to query connected systems and return a concise summary of findings.\nFocus on the specific query. Do not take actions or propose changes. Return a structured summary of 200-500 tokens.',
        10,
      ),
    );

    // 2. agent_override (priority 9) — simple agent override
    if (this.repo.agents.simple) {
      sections.push(
        this.section('agent_override', this.repo.agents.simple, 9),
      );
    }

    // 3. connections (priority 8)
    const connectionsContent = this.buildConnectionsContent();
    if (connectionsContent) {
      sections.push(this.section('connections', connectionsContent, 8));
    }

    // 4. knowledge (priority 6)
    const knowledgeContent = this.buildKnowledgeContent();
    if (knowledgeContent) {
      sections.push(this.section('knowledge', knowledgeContent, 6));
    }

    // 5. field_guidance (priority 5)
    if (session.fieldGuidance) {
      sections.push(
        this.section(
          'field_guidance',
          `## Field Access Restrictions\n${session.fieldGuidance}`,
          5,
        ),
      );
    }

    // 6. scope_descriptions (priority 4)
    const scopeEntries = Object.entries(session.scopeLabels);
    if (scopeEntries.length > 0) {
      const lines = scopeEntries.map(
        ([entity, label]) => `- ${entity}: ${label}`,
      );
      sections.push(
        this.section(
          'scope_descriptions',
          `## Data Scope\n${lines.join('\n')}`,
          4,
        ),
      );
    }

    return this.buildResult(sections);
  }

  private section(
    name: string,
    content: string,
    priority: number,
  ): ContextSection {
    return {
      name,
      content,
      tokens: 0, // TokenAllocator will compute
      priority,
      trimmed: false,
    };
  }

  private buildConnectionsContent(): string {
    if (this.repo.connections.size === 0) {
      return '';
    }

    const parts: string[] = [];
    for (const [, conn] of this.repo.connections) {
      const lines: string[] = [`## Connection: ${conn.name}`];

      // Surface endpoints
      const includedEndpoints = conn.surface.filter((ep) => ep.included);
      if (includedEndpoints.length > 0) {
        lines.push('', '### Available Endpoints');
        for (const ep of includedEndpoints) {
          lines.push(`${ep.method} ${ep.path} — ${ep.description}`);
        }
      }

      // Entities
      if (conn.entities) {
        lines.push('', '### Entities', conn.entities);
      }

      // Rules
      if (conn.rules) {
        lines.push('', '### Rules', conn.rules);
      }

      parts.push(lines.join('\n'));
    }

    return parts.join('\n\n');
  }

  private buildSkillsContent(): string {
    if (this.repo.skills.length === 0) {
      return '';
    }

    const lines = ['## Available Skills', ''];
    for (const skill of this.repo.skills) {
      const trigger = skill.trigger ?? 'Manual activation';
      lines.push(`- **${skill.name}**: ${skill.description}`);
      lines.push(`  Trigger: ${trigger}`);
    }

    return lines.join('\n');
  }

  private buildKnowledgeContent(): string {
    if (this.repo.knowledge.length === 0) {
      return '';
    }

    const lines = ['## Knowledge Base'];
    for (const doc of this.repo.knowledge) {
      lines.push('', `### ${doc.title}`, doc.body);
    }

    return lines.join('\n');
  }

  private buildResult(sections: ContextSection[]): CompiledContext {
    const {included, trimmed, totalTokens} = this.allocator.allocate(sections);

    const allSections = [...included, ...trimmed];
    const sectionBreakdown: Record<string, number> = {};
    for (const s of allSections) {
      sectionBreakdown[s.name] = s.tokens;
    }

    const total = this.allocator.budget;
    const systemPrompt = included.map((s) => s.content).join('\n\n');

    return {
      systemPrompt,
      tokenUsage: {
        total,
        used: totalTokens,
        remaining: total - totalTokens,
        sectionBreakdown,
      },
      sections: allSections,
    };
  }
}
