---
"@amodalai/core": patch
"@amodalai/runtime": patch
---

Remove duplicate RuntimeProvider system, migrate evals to Vercel AI SDK

The eval judge now uses `generateText()` from the Vercel AI SDK instead of the custom RuntimeProvider
abstraction. This removes ~1,500 lines of duplicate provider code and eliminates the `@anthropic-ai/sdk`,
`openai`, `@google/genai`, and `@aws-sdk/client-bedrock-runtime` optional dependencies from `@amodalai/core`.

Also removes `@anthropic-ai/sdk` from `@amodalai/runtime` (it was unused — runtime uses `@ai-sdk/anthropic`).
