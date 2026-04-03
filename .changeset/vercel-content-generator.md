---
"@amodalai/runtime": patch
---

Replace MultiProviderContentGenerator with VercelContentGenerator bridge. LLM calls now route through the Vercel AI SDK instead of our custom RuntimeProvider implementations. All 5 provider round-trip tests pass (Anthropic, OpenAI, Google, DeepSeek, Groq).
