# Content Generator Bridge Specification

> Phase 1.2b investigation output. Documents the exact interface GeminiClient
> expects from its content generator, so Phase 1.3 can build the AI SDK bridge.

## Interface: ContentGenerator

The upstream `GeminiClient` calls its content generator through 4 methods.
Only `generateContentStream` and `countTokens` are on the critical path.

```typescript
interface ContentGenerator {
  generateContent(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<GenerateContentResponse>;

  generateContentStream(
    request: GenerateContentParameters,
    userPromptId: string,
    role: LlmRole,
  ): Promise<AsyncGenerator<GenerateContentResponse>>;

  countTokens(request: CountTokensParameters): Promise<{ totalTokens: number }>;

  embedContent(request: EmbedContentParameters): Promise<EmbedContentResponse>;

  // Optional properties (checked but not required)
  userTier?: string;
  userTierName?: string;
  paidTier?: unknown;
}
```

## Request Shape: GenerateContentParameters

```typescript
interface GenerateContentParameters {
  model: string;
  contents: Content[]; // Content = { role: string; parts: Part[] }
  config?: {
    systemInstruction?: string | Content;
    tools?: Array<{ functionDeclarations?: FunctionDeclaration[] }>;
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    abortSignal?: AbortSignal;
  };
}
```

## Response Shape: GenerateContentResponse

```typescript
interface GenerateContentResponse {
  candidates?: Array<{
    content: { role: string; parts: Part[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    cachedContentTokenCount?: number;
  };
}

type Part =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; id: string; response: unknown } };
```

## How GeminiClient Calls the Content Generator

### Streaming (critical path — `geminiChat.js:425`)

```javascript
const stream = await config
  .getContentGenerator()
  .generateContentStream(
    { model: modelToUse, contents: contentsToUse, config },
    prompt_id,
    role,
  );
// Iterates the async generator, yielding events
```

### Non-streaming (`client.js:701`)

```javascript
const response = await this.getContentGeneratorOrFail().generateContent(
  { model: currentAttemptModel, config: requestConfig, contents },
  this.lastPromptId,
  role,
);
```

### Token counting (context window checks)

```javascript
const { totalTokens } = await contentGenerator.countTokens({
  contents,
  model,
  systemInstruction,
  tools,
});
```

## How the Content Generator Is Attached

In `AmodalConfig.initializeAuth()` (`packages/core/src/amodal-config.ts:391`):

```typescript
const raw = this.config as unknown as Record<string, unknown>;
raw["contentGenerator"] = generator; // private field access
```

## Existing Conversion Layer

The current `MultiProviderContentGenerator` uses two conversion modules:

- **`google-to-llm.ts`** — `convertGenerateContentParams()` maps Google request → our `LLMChatRequest`
- **`llm-to-google.ts`** — `convertLLMResponse()` and `convertStreamEvent()` map our response → Google format

## Bridge Strategy for Phase 1.3

The new bridge must:

1. Implement the same 4-method interface structurally
2. Use `createProvider()` (from Phase 1.2) instead of the old `RuntimeProvider`
3. Map Google `GenerateContentParameters` → AI SDK `ModelMessage[]`
4. Map AI SDK stream events → Google `GenerateContentResponse` chunks
5. Be set on the upstream Config via the same private field access pattern

### Key Decisions

**Reuse vs. rewrite the conversion layer:**
The existing `google-to-llm.ts` / `llm-to-google.ts` handle edge cases
(tool name patching, streaming tool calls, abort signals). The AI SDK
bridge should reuse the Google→LLM direction but write a new LLM→Google
direction since AI SDK stream events have a different shape than our
current `LLMStreamEvent`.

**countTokens:**
The current implementation is a rough estimate (chars / 4). The AI SDK
doesn't provide a `countTokens` utility for all providers. Keep the
estimate for now — it's only used for context window overflow checks.

**embedContent:**
Not used in the agent loop. Throw `Error('not supported')` like today.

**userPromptId / role parameters:**
These are metadata for logging/telemetry. Pass through to our logger
in the bridge but don't send to the AI SDK.
