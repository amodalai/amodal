/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import {AmodalError} from '../errors.js';

// ---------------------------------------------------------------------------
// Channel plugin errors
// ---------------------------------------------------------------------------

/**
 * Error loading a channel plugin package (missing, invalid export shape).
 */
export class ChannelPluginError extends AmodalError {
  readonly channelType: string;

  constructor(
    message: string,
    options: {
      channelType: string;
      cause?: unknown;
      context?: Record<string, unknown>;
    },
  ) {
    super('CHANNEL_PLUGIN_ERROR', message, {
      channelType: options.channelType,
      ...options.context,
    }, options.cause);
    this.name = 'ChannelPluginError';
    this.channelType = options.channelType;
  }
}

/**
 * Error in channel session mapping (missing factory, lookup failure).
 */
export class ChannelSessionError extends AmodalError {
  readonly channelType: string;

  constructor(
    message: string,
    options: {
      channelType: string;
      cause?: unknown;
      context?: Record<string, unknown>;
    },
  ) {
    super('CHANNEL_SESSION_ERROR', message, {
      channelType: options.channelType,
      ...options.context,
    }, options.cause);
    this.name = 'ChannelSessionError';
    this.channelType = options.channelType;
  }
}

/**
 * Error validating a channel's config block against its plugin schema.
 */
export class ChannelConfigError extends AmodalError {
  readonly channelType: string;

  constructor(
    message: string,
    options: {
      channelType: string;
      cause?: unknown;
      context?: Record<string, unknown>;
    },
  ) {
    super('CHANNEL_CONFIG_ERROR', message, {
      channelType: options.channelType,
      ...options.context,
    }, options.cause);
    this.name = 'ChannelConfigError';
    this.channelType = options.channelType;
  }
}
