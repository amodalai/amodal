/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Pluggable credential resolution. Connection specs reference credentials
 * via prefixed strings (env:KEY, scope:KEY). Resolvers handle each prefix.
 */
export interface CredentialResolver {
  resolve(ref: string): Promise<string | undefined>;
}

/**
 * Resolves env:KEY references from process.env.
 */
export class EnvCredentialResolver implements CredentialResolver {
  async resolve(ref: string): Promise<string | undefined> {
    if (!ref.startsWith('env:')) return undefined;
    return process.env[ref.slice(4)];
  }
}

/**
 * Resolves scope:KEY references from a per-scope secrets map.
 * In local dev, loaded from .amodal/scopes.json.
 * In cloud, the PlatformScopeResolver (cloud repo) calls the platform API.
 */
export class ScopeSecretsResolver implements CredentialResolver {
  constructor(private readonly secrets: Record<string, string>) {}

  async resolve(ref: string): Promise<string | undefined> {
    if (!ref.startsWith('scope:')) return undefined;
    return this.secrets[ref.slice(6)];
  }
}

/**
 * Tries multiple resolvers in order. Returns the first non-undefined result.
 * Falls back to treating the ref as a literal string if no resolver matches.
 */
export class ChainResolver implements CredentialResolver {
  constructor(private readonly resolvers: CredentialResolver[]) {}

  async resolve(ref: string): Promise<string | undefined> {
    for (const resolver of this.resolvers) {
      const result = await resolver.resolve(ref);
      if (result !== undefined) return result;
    }
    // No resolver matched a prefix — treat as literal value
    return ref;
  }
}
