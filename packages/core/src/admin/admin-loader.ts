/**
 * @license
 * Copyright 2025 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {readFile, readdir} from 'node:fs/promises';
import * as path from 'node:path';

import {parseSkill, parseKnowledge} from '../repo/parsers.js';
import type {LoadedKnowledge, LoadedSkill} from '../repo/repo-types.js';

/**
 * Content loaded from the admin agent directory.
 */
export interface AdminAgentContent {
  /** Agent personality override (agents/main.md) */
  agentPrompt: string | null;
  /** Admin skills (add-connection, write-skill, etc.) */
  skills: LoadedSkill[];
  /** Admin knowledge (schemas, patterns, common mistakes) */
  knowledge: LoadedKnowledge[];
}

/**
 * Load the admin agent content from a directory.
 * The directory should contain agents/, skills/, and knowledge/ subdirs.
 */
export async function loadAdminAgent(agentDir: string): Promise<AdminAgentContent> {
  const skills: LoadedSkill[] = [];
  const knowledge: LoadedKnowledge[] = [];

  // Load agent prompt
  let agentPrompt: string | null = null;
  try {
    agentPrompt = await readFile(path.join(agentDir, 'agents', 'main.md'), 'utf-8');
  } catch {
    // No agent override
  }

  // Load skills
  const skillsDir = path.join(agentDir, 'skills');
  try {
    const skillDirs = await readdir(skillsDir, {withFileTypes: true});
    for (const entry of skillDirs) {
      if (!entry.isDirectory()) continue;
      const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
      try {
        const content = await readFile(skillPath, 'utf-8');
        const skill = parseSkill(content, skillPath);
        if (skill) skills.push(skill);
      } catch {
        // Skip invalid skills
      }
    }
  } catch {
    // No skills directory
  }

  // Load knowledge
  const kbDir = path.join(agentDir, 'knowledge');
  try {
    const kbFiles = await readdir(kbDir, {withFileTypes: true});
    for (const entry of kbFiles) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const filePath = path.join(kbDir, entry.name);
      try {
        const content = await readFile(filePath, 'utf-8');
        const name = entry.name.replace(/\.md$/, '');
        const doc = parseKnowledge(content, name, filePath);
        knowledge.push(doc);
      } catch {
        // Skip invalid docs
      }
    }
  } catch {
    // No knowledge directory
  }

  return {agentPrompt, skills, knowledge};
}
