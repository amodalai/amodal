# @amodalai/amodal

## 0.1.9

### Patch Changes

- [#34](https://github.com/amodalai/amodal/pull/34) [`7e0bad6`](https://github.com/amodalai/amodal/commit/7e0bad6d7f53392060d00db2678de0cd8fa461c8) Thanks [@gte620v](https://github.com/gte620v)! - Add light/dark mode toggle in the web UI header. Preference persists to localStorage. Dark mode is the default.

- [#36](https://github.com/amodalai/amodal/pull/36) [`992d0e0`](https://github.com/amodalai/amodal/commit/992d0e0b3655149d95854407301412e93147cec2) Thanks [@gte620v](https://github.com/gte620v)! - Publish runtime-app to npm so the web chat UI works with global CLI installs. Previously marked private, which meant `npm install -g @amodalai/amodal` couldn't resolve the runtime-app dependency.

- [#33](https://github.com/amodalai/amodal/pull/33) [`fcdf153`](https://github.com/amodalai/amodal/commit/fcdf15370b5211ad0bd3ca30dc61a6ba755249d7) Thanks [@gte620v](https://github.com/gte620v)! - Add session history UI: browse past conversations, view full message replay with markdown rendering, and resume from session detail page.

- [#31](https://github.com/amodalai/amodal/pull/31) [`dd9a04f`](https://github.com/amodalai/amodal/commit/dd9a04fcd732abc17188cc473a9ea4794922acfc) Thanks [@gte620v](https://github.com/gte620v)! - Persist chat sessions to disk. Sessions survive server restarts and can be resumed with `amodal chat --resume latest` or `--resume <session-id>`.

- [#35](https://github.com/amodalai/amodal/pull/35) [`f9d4e5f`](https://github.com/amodalai/amodal/commit/f9d4e5fde9c623a8f93f8ab6471263824489a86a) Thanks [@gte620v](https://github.com/gte620v)! - Display token usage in the web chat UI. Tracks cumulative input/output tokens across all turns in a session. Usage data flows from LLM provider → agent runner → SSE done event → react hook → UI.

- Updated dependencies [[`992d0e0`](https://github.com/amodalai/amodal/commit/992d0e0b3655149d95854407301412e93147cec2), [`dd9a04f`](https://github.com/amodalai/amodal/commit/dd9a04fcd732abc17188cc473a9ea4794922acfc), [`f9d4e5f`](https://github.com/amodalai/amodal/commit/f9d4e5fde9c623a8f93f8ab6471263824489a86a)]:
  - @amodalai/runtime-app@0.1.9
  - @amodalai/runtime@0.1.9
  - @amodalai/core@0.1.9

## 0.1.8

### Patch Changes

- [#27](https://github.com/amodalai/amodal/pull/27) [`e5ffdf0`](https://github.com/amodalai/amodal/commit/e5ffdf0f6cdbb6b4d9f62a9a9d3e481a61931a37) Thanks [@gte620v](https://github.com/gte620v)! - Fix browser chat UI not loading: correct package scope typo in runtime-app path resolution.

- [#30](https://github.com/amodalai/amodal/pull/30) [`ccd38eb`](https://github.com/amodalai/amodal/commit/ccd38eb0a72a07cabada10fb501fd95aae88ee46) Thanks [@gte620v](https://github.com/gte620v)! - Polish web chat UI: dark theme, real Amodal logo, greyscale favicon, markdown rendering, auto-grow input, connections and skills in sidebar, smarter streaming indicators.

- Updated dependencies []:
  - @amodalai/core@0.1.8
  - @amodalai/runtime@0.1.8
  - @amodalai/runtime-app@0.1.8

## 0.1.7

### Patch Changes

- [#26](https://github.com/amodalai/amodal/pull/26) [`5c6d813`](https://github.com/amodalai/amodal/commit/5c6d813345bfe607fd13a3414aa735fe3249a281) Thanks [@gte620v](https://github.com/gte620v)! - Fix input lag in terminal chat. Scroll keybindings (j/k/pageUp/pageDown) no longer intercept keystrokes while typing in the input bar.

- [#24](https://github.com/amodalai/amodal/pull/24) [`90ce461`](https://github.com/amodalai/amodal/commit/90ce46146398cad6e33f1b0794457142d7b38f1a) Thanks [@gte620v](https://github.com/gte620v)! - Add live connection testing to validate command and testPath field to connection spec

- Updated dependencies [[`90ce461`](https://github.com/amodalai/amodal/commit/90ce46146398cad6e33f1b0794457142d7b38f1a)]:
  - @amodalai/core@0.1.7
  - @amodalai/runtime@0.1.7
  - @amodalai/runtime-app@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies [[`e4c29ea`](https://github.com/amodalai/amodal/commit/e4c29ea5f768f1514e82fef2585bb7f63588075a)]:
  - @amodalai/core@0.1.6
  - @amodalai/runtime@0.1.6
  - @amodalai/runtime-app@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies [[`d0778a5`](https://github.com/amodalai/amodal/commit/d0778a521f2f298fe7ca144c37211c4af3bdc392)]:
  - @amodalai/core@0.1.5
  - @amodalai/runtime@0.1.5
  - @amodalai/runtime-app@0.1.5

## 0.1.4

### Patch Changes

- [#17](https://github.com/amodalai/amodal/pull/17) [`7a2b7d1`](https://github.com/amodalai/amodal/commit/7a2b7d1dd27588b626a23453f0f97f5e9317b275) Thanks [@gte620v](https://github.com/gte620v)! - Fix GitHub Release creation after npm publish

- Updated dependencies []:
  - @amodalai/core@0.1.4
  - @amodalai/runtime@0.1.4
  - @amodalai/runtime-app@0.1.4

## 0.1.3

### Patch Changes

- [#15](https://github.com/amodalai/amodal/pull/15) [`df201b5`](https://github.com/amodalai/amodal/commit/df201b542d943fbb887dd096f4e3e3d170c51030) Thanks [@gte620v](https://github.com/gte620v)! - Automatically load `.env` file from the project directory. No more `source .env &&` before every command.

- Updated dependencies []:
  - @amodalai/core@0.1.3
  - @amodalai/runtime@0.1.3
  - @amodalai/runtime-app@0.1.3

## 0.1.2

### Patch Changes

- [#13](https://github.com/amodalai/amodal/pull/13) [`2c767b7`](https://github.com/amodalai/amodal/commit/2c767b7265f112148ce88ee27001d8e38ac8c970) Thanks [@gte620v](https://github.com/gte620v)! - Fix `amodal --version` showing `0.0.0`. Read version from package.json at runtime as fallback when CLI is not bundled with esbuild. Rename package from `@amodalai/cli` to `@amodalai/amodal`.

- Updated dependencies []:
  - @amodalai/core@0.1.2
  - @amodalai/runtime@0.1.2
  - @amodalai/runtime-app@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies []:
  - @amodalai/runtime-app@0.1.1
  - @amodalai/core@0.1.1
  - @amodalai/runtime@0.1.1
