# @amodalai/runtime-app

## 0.1.21

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.1.21

## 0.1.20

### Patch Changes

- [#89](https://github.com/amodalai/amodal/pull/89) [`5fa7089`](https://github.com/amodalai/amodal/commit/5fa7089e2ee8ee92432fc3891fa859779507d1bb) Thanks [@whodatdev](https://github.com/whodatdev)! - Remove monorepo-relative @amodalai/react alias from vite config. The published @amodalai/react package has proper exports, so vite resolves it from node_modules without the alias. This fixes build server builds that use the npm package outside the monorepo.

- Updated dependencies [[`5fa7089`](https://github.com/amodalai/amodal/commit/5fa7089e2ee8ee92432fc3891fa859779507d1bb)]:
  - @amodalai/react@0.1.20

## 0.1.19

### Patch Changes

- [#87](https://github.com/amodalai/amodal/pull/87) [`fb31766`](https://github.com/amodalai/amodal/commit/fb31766bcd04861f5d51dcffe345383c15909580) Thanks [@whodatdev](https://github.com/whodatdev)! - Remove monorepo-relative @amodalai/react alias from vite config. The published @amodalai/react package has proper exports, so vite resolves it from node_modules without the alias. This fixes build server builds that use the npm package outside the monorepo.

- Updated dependencies []:
  - @amodalai/react@0.1.19

## 0.1.18

### Patch Changes

- [#80](https://github.com/amodalai/amodal/pull/80) [`7cac298`](https://github.com/amodalai/amodal/commit/7cac298da6411b0df9bb798aece918aeb6f8faba) Thanks [@gte620v](https://github.com/gte620v)! - Add stop button to main chat and admin chat. Appears as a gray square icon during streaming, replacing the send button. Remove unused test/.amodal fixture and stale root CHANGELOG.md.

- [#85](https://github.com/amodalai/amodal/pull/85) [`c8b5bae`](https://github.com/amodalai/amodal/commit/c8b5bae686a8225cf80331d339db4c79eaf0009d) Thanks [@whodatdev](https://github.com/whodatdev)! - Remove app_id from client-server protocol. Server resolves app from hostname/auth context.

  Breaking: AmodalProvider no longer accepts appId prop. RuntimeClient no longer sends app_id. SessionCreator and SessionHydrator signatures changed. Chat/task schemas no longer include app_id.

  New: POST /auth/token on local dev returns empty token. useAuth hook replaces useHostedConfig. runtime-app publishes source for hosted builds. CLI deploy triggers remote Fly build.

- Updated dependencies [[`c8b5bae`](https://github.com/amodalai/amodal/commit/c8b5bae686a8225cf80331d339db4c79eaf0009d)]:
  - @amodalai/react@0.1.18

## 0.1.17

### Patch Changes

- [#77](https://github.com/amodalai/amodal/pull/77) [`86084ff`](https://github.com/amodalai/amodal/commit/86084ff0435e58bcb0f738ae88ef6179a3278f9d) Thanks [@gte620v](https://github.com/gte620v)! - Split Evals page into Eval Suite (pass/fail cards, no model picker) and Model Arena (multi-model comparison). Add Run All button and expand/collapse all controls to Eval Suite.

- [#78](https://github.com/amodalai/amodal/pull/78) [`14ef749`](https://github.com/amodalai/amodal/commit/14ef749ba9ccf3b74dbf86e3959c609682eda198) Thanks [@gte620v](https://github.com/gte620v)! - Show installed package files in the config Files view alongside local repo files. Package files display a purple package icon and "package" badge in the editor.

- Updated dependencies [[`fb49f28`](https://github.com/amodalai/amodal/commit/fb49f284bc427e7dc13a0c43653a55a28b23afb3)]:
  - @amodalai/react@0.1.17

## 0.1.16

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.1.16

## 0.1.15

### Patch Changes

- [#62](https://github.com/amodalai/amodal/pull/62) [`c2298d6`](https://github.com/amodalai/amodal/commit/c2298d614e86491d07c954092d2044b32dd94281) Thanks [@gte620v](https://github.com/gte620v)! - Add admin agent file tools (read, write, delete) for configuring agents via chat. Config UI improvements: sidebar admin toggle, persistent chat, file tree auto-refresh with reload button. Fix runtime-app package.json exports for running from source.

- [#65](https://github.com/amodalai/amodal/pull/65) [`f4f538e`](https://github.com/amodalai/amodal/commit/f4f538ef39f970820dce5955acdd363cc2c56247) Thanks [@whodatdev](https://github.com/whodatdev)! - Refactor runtime app to use deploy-id based config bootstrap. Add useHostedConfig hook that fetches config from the platform API instead of reading server-injected window.**AMODAL_CONFIG**. Load .env from project directory in dev command. Export ./package.json from runtime-app for require.resolve compatibility.

- [#63](https://github.com/amodalai/amodal/pull/63) [`9319d95`](https://github.com/amodalai/amodal/commit/9319d9536a6dac0afa325df49fa9c6f5773f5835) Thanks [@gte620v](https://github.com/gte620v)! - Eval UI on config page, dev workflow improvements (pnpm link, dev:build, -dev version suffix).

- Updated dependencies []:
  - @amodalai/react@0.1.15

## 0.1.14

### Patch Changes

- [#60](https://github.com/amodalai/amodal/pull/60) [`ca4285d`](https://github.com/amodalai/amodal/commit/ca4285d545290ef6c61b0b39d7cfce7ca19e236c) Thanks [@gte620v](https://github.com/gte620v)! - Session rename/delete, rich tool call cards, admin chat split pane, suppress OpenTelemetry warning, init cleanup.

- Updated dependencies [[`ca4285d`](https://github.com/amodalai/amodal/commit/ca4285d545290ef6c61b0b39d7cfce7ca19e236c)]:
  - @amodalai/react@0.1.14

## 0.1.13

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.1.13

## 0.1.12

### Patch Changes

- [#53](https://github.com/amodalai/amodal/pull/53) [`d645049`](https://github.com/amodalai/amodal/commit/d6450493413c4ae506d22438e0e5e4bfe5484f9a) Thanks [@gte620v](https://github.com/gte620v)! - Add admin agent for config chat. Fetched from registry, cached at ~/.amodal/admin-agent/. Config section defaults to admin chat. Update via `amodal update --admin-agent`.

- Updated dependencies []:
  - @amodalai/react@0.1.12

## 0.1.11

### Patch Changes

- [#47](https://github.com/amodalai/amodal/pull/47) [`61ab675`](https://github.com/amodalai/amodal/commit/61ab67585161c751772c89126d2fa1e8fe03ce8a) Thanks [@gte620v](https://github.com/gte620v)! - Add file browser and editor to config screen

- [#44](https://github.com/amodalai/amodal/pull/44) [`fe4785d`](https://github.com/amodalai/amodal/commit/fe4785d0106eb39583b64b282bb89522dcaf92ef) Thanks [@gte620v](https://github.com/gte620v)! - Unified connection and MCP view with per-connection health status

- Updated dependencies []:
  - @amodalai/react@0.1.11

## 0.1.10

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.1.10

## 0.1.9

### Patch Changes

- [#36](https://github.com/amodalai/amodal/pull/36) [`992d0e0`](https://github.com/amodalai/amodal/commit/992d0e0b3655149d95854407301412e93147cec2) Thanks [@gte620v](https://github.com/gte620v)! - Publish runtime-app to npm so the web chat UI works with global CLI installs. Previously marked private, which meant `npm install -g @amodalai/amodal` couldn't resolve the runtime-app dependency.

- Updated dependencies [[`f9d4e5f`](https://github.com/amodalai/amodal/commit/f9d4e5fde9c623a8f93f8ab6471263824489a86a)]:
  - @amodalai/react@0.1.9

## 0.1.8

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.1.8

## 0.1.7

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.1.7

## 0.1.6

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.1.6

## 0.1.5

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.1.5

## 0.1.4

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.1.4

## 0.1.3

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.1.3

## 0.1.2

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [[`3b76e05`](https://github.com/amodalai/amodal/commit/3b76e0594f3c71fda26481342ff3bf445a7e291b)]:
  - @amodalai/react@0.1.1
