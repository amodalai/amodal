/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * A user preference learned across sessions.
 */
export interface UserPreference {
  id: string;
  category: 'style' | 'content' | 'behavior' | 'domain';
  preference: string;
  confidence: number;
  source: 'correction' | 'explicit' | 'inferred';
}

/**
 * Client for fetching and reporting user preferences via the platform API.
 */
export class PreferenceClient {
  private readonly url: string;
  private readonly apiKey: string;

  constructor(platformUrl: string, apiKey: string) {
    this.url = platformUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  /**
   * Fetch approved preferences for a user.
   */
  async fetchPreferences(userId: string, orgId: string): Promise<UserPreference[]> {
    try {
      const response = await fetch(
        `${this.url}/api/learning/preferences?userId=${encodeURIComponent(userId)}&orgId=${encodeURIComponent(orgId)}`,
        {headers: {'Authorization': `Bearer ${this.apiKey}`}},
      );

      if (!response.ok) return [];

      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- platform response
      const data = await response.json() as {preferences: UserPreference[]};
      return data.preferences;
    } catch {
      return []; // Graceful degradation
    }
  }

  /**
   * Report a newly detected preference.
   */
  async reportPreference(
    userId: string,
    orgId: string,
    preference: {category: string; preference: string; source: string},
    sessionId?: string,
  ): Promise<void> {
    try {
      await fetch(`${this.url}/api/learning/preferences`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          userId,
          orgId,
          ...preference,
          sessionId,
        }),
      });
    } catch {
      // Swallow — preference reporting must not break the session
    }
  }
}

/**
 * Format preferences as a system prompt section.
 */
export function formatPreferencesPrompt(preferences: UserPreference[]): string {
  if (preferences.length === 0) return '';

  const lines = ['## Known User Preferences', ''];

  for (const pref of preferences) {
    lines.push(`- [${pref.category}] ${pref.preference} (confidence: ${(pref.confidence * 100).toFixed(0)}%)`);
  }

  lines.push('');
  lines.push('Apply these preferences when generating responses. They were learned from previous interactions.');

  return lines.join('\n');
}
