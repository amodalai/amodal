# @amodalai/core

## 0.1.16

### Patch Changes

- [#69](https://github.com/amodalai/amodal/pull/69) [`407b935`](https://github.com/amodalai/amodal/commit/407b93586178fa19d7c6162f03e259039df336c4) Thanks [@gte620v](https://github.com/gte620v)! - Add prompt caching, multi-model eval comparison, and new provider support
  - Anthropic prompt caching: system prompt and tools sent with cache_control, 90% input cost savings on cache hits
  - Cache-aware cost tracking throughout eval system with savings display
  - Multi-model eval comparison: run evals against multiple models side-by-side with color-graded time/cost table
  - Per-eval history with assertion breakdown, model info, and collapsible UI
  - DeepSeek and Groq provider support via OpenAI-compatible endpoints
  - Configurable eval timeout (20s–300s slider)
  - Tool results now visible in eval output for judge verification
  - Improved judge prompt for specific, evidence-based failure reasoning
  - Auth/rate-limit errors surfaced with actionable UI messaging
  - ConfigWatcher no longer triggers reload spam from eval result writes
  - Session reuse during eval runs to minimize MCP reconnections

- [#68](https://github.com/amodalai/amodal/pull/68) [`f99b2a1`](https://github.com/amodalai/amodal/commit/f99b2a1d836ee4f57a335182897af696bfce9502) Thanks [@whodatdev](https://github.com/whodatdev)! - Unify local and hosted server onto a single SessionManager, replacing AgentSessionManager + runAgentTurn with SessionManager + streamMessage. Adds minimal Config init for non-Google providers, CustomToolAdapter for repo tools, and configurable coreTools from repo config.

## 0.1.15

## 0.1.14

## 0.1.13

## 0.1.12

### Patch Changes

- [#53](https://github.com/amodalai/amodal/pull/53) [`d645049`](https://github.com/amodalai/amodal/commit/d6450493413c4ae506d22438e0e5e4bfe5484f9a) Thanks [@gte620v](https://github.com/gte620v)! - Add admin agent for config chat. Fetched from registry, cached at ~/.amodal/admin-agent/. Config section defaults to admin chat. Update via `amodal update --admin-agent`.

## 0.1.11

### Patch Changes

- [#49](https://github.com/amodalai/amodal/pull/49) [`26034c6`](https://github.com/amodalai/amodal/commit/26034c6ac223b0e203f59ab820858ff3e3fe47de) Thanks [@gte620v](https://github.com/gte620v)! - Untyped package registry with dependency resolution. Packages are bundles that can contain any combination of connections, skills, automations, knowledge, stores, tools, pages, and agents. Lock file keyed by npm name. npm handles transitive dependency resolution. CLI simplified: `amodal install <name>` instead of `amodal install <type> <name>`.

## 0.1.10

## 0.1.9

## 0.1.8

## 0.1.7

### Patch Changes

- [#24](https://github.com/amodalai/amodal/pull/24) [`90ce461`](https://github.com/amodalai/amodal/commit/90ce46146398cad6e33f1b0794457142d7b38f1a) Thanks [@gte620v](https://github.com/gte620v)! - Add live connection testing to validate command and testPath field to connection spec

## 0.1.6

### Patch Changes

- [#21](https://github.com/amodalai/amodal/pull/21) [`e4c29ea`](https://github.com/amodalai/amodal/commit/e4c29ea5f768f1514e82fef2585bb7f63588075a) Thanks [@gte620v](https://github.com/gte620v)! - Add headers support for MCP HTTP/SSE transports to enable authenticated MCP servers

## 0.1.5

### Patch Changes

- [#19](https://github.com/amodalai/amodal/pull/19) [`d0778a5`](https://github.com/amodalai/amodal/commit/d0778a521f2f298fe7ca144c37211c4af3bdc392) Thanks [@gte620v](https://github.com/gte620v)! - Rename `source` to `specUrl` (optional) and make `baseUrl` required in connection spec.json. Connections without an API spec document no longer fail validation.

## 0.1.4

## 0.1.3

## 0.1.2

## 0.1.1
