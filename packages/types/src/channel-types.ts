/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

/**
 * Messaging channel types.
 *
 * Public interfaces for the channel plugin system. All types are
 * zero-dep — no runtime imports. Channel plugins (`@amodalai/channel-*`)
 * depend only on this package for type contracts.
 *
 * Architecture: ChannelAdapter (wire format + auth) → ChannelSessionMapper
 * (session affinity) → existing SessionManager.
 */

// ---------------------------------------------------------------------------
// Webhook request (decouples adapters from Express)
// ---------------------------------------------------------------------------

/**
 * Minimal request shape passed to channel adapters. Extracted from the
 * HTTP framework (Express, Hono, etc.) so adapters have no framework dep.
 */
export interface ChannelWebhookRequest {
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

/** Normalized inbound message from any channel. */
export interface IncomingMessage {
  channelType: string;
  channelUserId: string;
  channelUserDisplay?: string;
  conversationId: string;
  messageId: string;
  text: string;
  timestamp: Date;
  /** Original channel payload, for debugging. */
  raw: unknown;
}

/** Outbound target address. */
export interface ChannelAddress {
  channelType: string;
  conversationId: string;
  replyToMessageId?: string;
}

// ---------------------------------------------------------------------------
// Channel adapter (wire-format translator + sender guard)
// ---------------------------------------------------------------------------

/**
 * Translates between channel wire format and the runtime's normalized
 * message types. Each channel plugin exports one adapter.
 *
 * `parseIncoming` returns `null` to reject the request (bad signature,
 * unauthorized sender, non-text update). The caller is responsible for
 * emitting the appropriate rejection event.
 */
export interface ChannelAdapter {
  readonly channelType: string;

  /**
   * Verify the webhook, check sender authorization, and normalize the
   * payload. Returns `null` to silently reject the request.
   */
  parseIncoming(req: ChannelWebhookRequest): Promise<IncomingMessage | null>;

  /** Send a text message to a channel conversation. */
  sendMessage(to: ChannelAddress, text: string): Promise<void>;

  /**
   * Start showing a processing/loading indicator. Each adapter decides how
   * (e.g. placeholder message, typing indicator, etc.).
   *
   * Returns a handle to stop the indicator and deliver the final response.
   * If not implemented, the route sends the response as a new message.
   */
  startProcessing?(conversationId: string): Promise<{
    stop(): void;
    finish(text: string): Promise<boolean>;
  }>;
}

// ---------------------------------------------------------------------------
// Session mapper (per-user session affinity)
// ---------------------------------------------------------------------------

export interface ChannelSessionMapResult {
  sessionId: string;
  isNew: boolean;
}

export interface ChannelSessionMapper {
  findOrCreateSession(
    channelType: string,
    channelUserId: string,
    displayName?: string,
  ): Promise<ChannelSessionMapResult>;

  resetSession(
    channelType: string,
    channelUserId: string,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Channel plugin (package entry point contract)
// ---------------------------------------------------------------------------

/**
 * The contract that every `@amodalai/channel-*` package must satisfy.
 * The runtime dynamically imports the package and expects this shape
 * as the default export.
 */
export interface ChannelPlugin {
  readonly channelType: string;
  /** Zod schema for validating the channel's config block. */
  readonly configSchema: {parse(data: unknown): unknown};
  createAdapter(config: unknown): ChannelAdapter;

  /**
   * Interactive setup flow for this channel. Called by `amodal channels setup <type>`.
   * The plugin prompts for credentials, writes config, and performs any
   * platform-specific registration (e.g. setting a webhook URL).
   *
   * @param context Setup context provided by the CLI.
   */
  setup?(context: ChannelSetupContext): Promise<void>;
}

/** Context passed to a channel plugin's interactive setup flow. */
export interface ChannelSetupContext {
  /** Absolute path to the repo root. */
  repoPath: string;
  /** Parsed amodal.json config. */
  config: Record<string, unknown>;
  /** The public webhook URL for this channel (e.g. from ngrok or deploy). */
  webhookUrl?: string;
  /** Write a key-value pair to the repo's .env file. */
  writeEnv(key: string, value: string): Promise<void>;
  /** Update amodal.json with the given partial config. */
  updateConfig(patch: Record<string, unknown>): Promise<void>;
  /** Prompt the user for input. */
  prompt(message: string, options?: {secret?: boolean; default?: string}): Promise<string>;
}

// ---------------------------------------------------------------------------
// Session metadata extension
// ---------------------------------------------------------------------------

/** Channel origin metadata stored on sessions created by channel messages. */
export interface ChannelOrigin {
  channelType: string;
  channelUserId: string;
  channelUserDisplay?: string;
}
