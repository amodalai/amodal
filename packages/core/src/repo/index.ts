/**
 * @license
 * Copyright 2026 Amodal Labs, Inc.
 * SPDX-License-Identifier: MIT
 */

// Types
export * from './repo-types.js';
export * from './connection-types.js';

// Schemas
export {
  AmodalConfigSchema,
  ModelConfigSchema,
  parseConfigJson,
  resolveEnvValue,
  resolveEnvValues,
} from './config-schema.js';
export type {AmodalConfig, ModelConfig} from './config-schema.js';
export {
  AccessConfigSchema,
  AlternativeLookupSchema,
  ConnectionSpecSchema,
  EndpointAccessSchema,
  FieldRestrictionSchema,
  ScopingRuleSchema,
  ThresholdSchema,
} from './connection-schemas.js';
export type {
  AccessConfig,
  AlternativeLookup,
  ConnectionSpec,
  EndpointAccess,
  FieldRestriction,
  ScopingRule,
  Threshold,
} from './connection-schemas.js';

// Parsers
export {
  parseAgent,
  parseConfig,
  parseAccessJson,
  parseSpecJson,
  parseConnection,
  parseSkill,
  parseKnowledge,
  parseAutomation,
  parseEval,
} from './parsers.js';
export {parseSurface} from './surface-parser.js';

// Store types
export type {
  StoreFieldType,
  StoreFieldDefinition,
  StoreEntityDefinition,
  StoreTtlConfig,
  StoreFailureConfig,
  StoreHistoryConfig,
  LoadedStore,
} from './store-types.js';
export {
  StoreJsonSchema,
  StoreFieldDefinitionSchema,
  StoreEntitySchema,
  StoreTtlConfigSchema,
  StoreFailureConfigSchema,
  StoreHistoryConfigSchema,
  STORE_NAME_REGEX,
} from './store-schemas.js';
export type {StoreJson} from './store-schemas.js';
export {loadStores, parseStoreJson} from './store-loader.js';
export {storeToJsonSchema, storeToToolName, findStoreByToolName, fieldToJsonSchema} from './store-tool-schema.js';

// Tool types
export {ToolJsonSchema, TOOL_NAME_REGEX, defineToolHandler} from './tool-types.js';
export type {ToolJson, LoadedTool, CustomToolContext, CustomToolExecutor, CustomShellExecutor, ToolHandlerDefinition} from './tool-types.js';
export {loadTools, isToolHandlerDefinition} from './tool-loader.js';

// Readers
export {loadRepoFromDisk} from './local-reader.js';
export {loadRepoFromPlatform} from './platform-reader.js';
export {loadRepo} from './repo-loader.js';

// Change detection (used by push webhook router to pick build mode)
export {isContentOnlyChange} from './change-detection.js';

// Sync utilities
export {parseOpenAPISpec, fetchAndParseSpec} from './openapi-parser.js';
export type {ParsedEndpoint, ParsedParameter} from './openapi-parser.js';
export {detectDrift} from './drift-detector.js';
export type {DriftResult, EndpointChange} from './drift-detector.js';
export {buildSyncPlan} from './spec-syncer.js';
export type {SyncPlan} from './spec-syncer.js';
