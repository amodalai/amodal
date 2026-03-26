/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

import type {OutputGuard} from '../security/output-guard.js';
import type {GuardFinding, GuardResult} from '../security/security-types.js';

/**
 * Configuration for the output pipeline.
 */
export interface OutputPipelineConfig {
  outputGuard: OutputGuard;
  onGuardDecision?: (result: GuardResult) => void;
}

/**
 * Result from processing agent output through the pipeline.
 */
export interface PipelineResult {
  output: string;
  modified: boolean;
  blocked: boolean;
  findings: GuardFinding[];
}

/**
 * Wraps OutputGuard in a pipeline suitable for both synchronous
 * and streaming use. Provides telemetry hooks and buffered stream
 * processing.
 */
export class OutputPipeline {
  private readonly outputGuard: OutputGuard;
  private readonly onGuardDecision?: (result: GuardResult) => void;

  constructor(config: OutputPipelineConfig) {
    this.outputGuard = config.outputGuard;
    this.onGuardDecision = config['onGuardDecision'];
  }

  /**
   * Process a complete agent response text through the guard.
   */
  process(text: string): PipelineResult {
    const guardResult = this.outputGuard.guard(text);

    if (this.onGuardDecision) {
      this.onGuardDecision(guardResult);
    }

    return {
      output: guardResult['output'],
      modified: guardResult['modified'],
      blocked: guardResult['blocked'],
      findings: guardResult['findings'],
    };
  }

  /**
   * Create a streaming processor that buffers tokens and guards on finalize.
   */
  createStreamProcessor(): StreamGuardProcessor {
    return new StreamGuardProcessor(this);
  }
}

/**
 * Buffers streaming tokens and runs the output guard on finalize.
 */
export class StreamGuardProcessor {
  private readonly pipeline: OutputPipeline;
  private buffer = '';

  constructor(pipeline: OutputPipeline) {
    this.pipeline = pipeline;
  }

  /**
   * Feed a token into the buffer. Tokens are accumulated
   * for guard processing on finalize.
   */
  feed(token: string): void {
    this.buffer += token;
  }

  /**
   * Get the current buffered text for intermediate streaming display.
   */
  getBuffer(): string {
    return this.buffer;
  }

  /**
   * Run the output guard on the full buffered text and return the result.
   */
  finalize(): PipelineResult {
    return this.pipeline.process(this.buffer);
  }
}
