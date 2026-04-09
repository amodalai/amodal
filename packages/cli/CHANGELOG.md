# @amodalai/amodal

## 0.2.6

### Patch Changes

- Updated dependencies [[`737c888`](https://github.com/amodalai/amodal/commit/737c888a13e7e0cba4f9cc88b5d99f7300984c48)]:
  - @amodalai/runtime-app@0.2.6
  - @amodalai/types@0.2.6
  - @amodalai/core@0.2.6
  - @amodalai/runtime@0.2.6

## 0.2.5

### Patch Changes

- Updated dependencies [[`7c2a1b3`](https://github.com/amodalai/amodal/commit/7c2a1b39531ea2cb011bf3a89a7d119440e5b55f)]:
  - @amodalai/runtime-app@0.2.5
  - @amodalai/types@0.2.5
  - @amodalai/core@0.2.5
  - @amodalai/runtime@0.2.5

## 0.2.4

### Patch Changes

- [#172](https://github.com/amodalai/amodal/pull/172) [`9599b4e`](https://github.com/amodalai/amodal/commit/9599b4e840cef07f3b443b0b2d490d2deabcb517) Thanks [@gte620v](https://github.com/gte620v)! - Add image paste support to chat

  Users can paste images from the clipboard into the chat input. Images show as removable thumbnails before sending, then render in the user message bubble. Vision-capable providers (Anthropic, Google, OpenAI) receive the image; non-vision providers strip it with a warning. Images are stored in a separate `image_data` column to avoid JSONB bloat, with automatic rehydration on session load.

- Updated dependencies [[`0132204`](https://github.com/amodalai/amodal/commit/0132204a35f457e067fc5150a219f264a0f0955c), [`9599b4e`](https://github.com/amodalai/amodal/commit/9599b4e840cef07f3b443b0b2d490d2deabcb517)]:
  - @amodalai/core@0.2.4
  - @amodalai/runtime@0.2.4
  - @amodalai/types@0.2.4
  - @amodalai/runtime-app@0.2.4

## 0.2.3

### Patch Changes

- Updated dependencies [[`83d0153`](https://github.com/amodalai/amodal/commit/83d01530ae0b85cf7333df75e6fe15cabb1cb63b)]:
  - @amodalai/types@0.2.3
  - @amodalai/core@0.2.3
  - @amodalai/runtime@0.2.3
  - @amodalai/runtime-app@0.2.3

## 0.2.2

### Patch Changes

- [#167](https://github.com/amodalai/amodal/pull/167) [`f4d59ea`](https://github.com/amodalai/amodal/commit/f4d59eae060aa5fa35e1f2f756413457a4d5331b) Thanks [@whodatdev](https://github.com/whodatdev)! - Add messaging channel plugin system
  - Channel plugins are npm packages discovered via channel.json, dynamically loaded at boot
  - Webhook router at POST /channels/:channelType/webhook with dedup, rate limiting, session affinity
  - Drizzle and in-memory session mappers for channel user → session mapping
  - ChannelPlugin interface with optional setup() for interactive CLI configuration
  - `amodal connect channel <pkg>` and `amodal connect connection <pkg>` commands
  - ChannelSetupContext for plugin-owned setup flows (prompt, writeEnv, updateConfig)

- [#166](https://github.com/amodalai/amodal/pull/166) [`1523d96`](https://github.com/amodalai/amodal/commit/1523d96f2bb1d6b5e2f0023690f9abb371b88fd3) Thanks [@whodatdev](https://github.com/whodatdev)! - Replace custom package registry with standard npm

  Packages are now standard npm dependencies installed to node_modules/.
  Declare installed packages in amodal.json `packages` array.
  - Remove custom registry, hidden npm context (amodal_packages/), and lock file (amodal.lock)
  - Add package-manager.ts (detectPackageManager, pmAdd, pmRemove, ensurePackageJson)
  - Resolver loads declared packages using same nested structure as local repo
  - amodal install/uninstall manage both npm deps and amodal.json packages array
  - Remove publish, search, diff, update, list commands (use npm directly)
  - Admin agent fetches from npmjs.org

- Updated dependencies [[`024207b`](https://github.com/amodalai/amodal/commit/024207b91220acfc9e44a73499dfd64124f54ab0), [`f4d59ea`](https://github.com/amodalai/amodal/commit/f4d59eae060aa5fa35e1f2f756413457a4d5331b), [`1523d96`](https://github.com/amodalai/amodal/commit/1523d96f2bb1d6b5e2f0023690f9abb371b88fd3), [`a33e080`](https://github.com/amodalai/amodal/commit/a33e0807e6607c88aa203f5dd2c1bf89299026d8)]:
  - @amodalai/core@0.2.2
  - @amodalai/types@0.2.2
  - @amodalai/runtime@0.2.2
  - @amodalai/runtime-app@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`80cfcfc`](https://github.com/amodalai/amodal/commit/80cfcfc63e8f67e80585f416ce3abdfdde0c966f), [`3ab8e19`](https://github.com/amodalai/amodal/commit/3ab8e19130ad6458171f2e3605bf6dc6be1bce6d), [`745228d`](https://github.com/amodalai/amodal/commit/745228db110b6da50e0514f6dc90250037ada958), [`cdcf62f`](https://github.com/amodalai/amodal/commit/cdcf62f90f42a3a6064f7e86cdcfa0293493e949), [`46f7c4a`](https://github.com/amodalai/amodal/commit/46f7c4a65478b0ee4a0115fde5415f65a760af16), [`5ea8f5e`](https://github.com/amodalai/amodal/commit/5ea8f5ed89000d7cef7e57e7cc56e64b1bc6191b), [`efedd6a`](https://github.com/amodalai/amodal/commit/efedd6ad75fdc420ef602fba45fc1992e884ee3a), [`901d606`](https://github.com/amodalai/amodal/commit/901d6065c5e4c7e5c3038757aeb476d352eb4335), [`bf907d4`](https://github.com/amodalai/amodal/commit/bf907d4f083fa000a246de1a749548a86dc2e3bf), [`7811174`](https://github.com/amodalai/amodal/commit/781117447532ed3bf513ce776b39e86d16220f90), [`5104a17`](https://github.com/amodalai/amodal/commit/5104a17315f9072a79e6f668bfff3d3f2473a330), [`7d6e825`](https://github.com/amodalai/amodal/commit/7d6e8257b790380ca599c8cb1a0d937bb3741dd1), [`57b143f`](https://github.com/amodalai/amodal/commit/57b143fac3c0de23651dd26a295be9ee553a91d1)]:
  - @amodalai/runtime@0.2.1
  - @amodalai/core@0.2.1
  - @amodalai/types@0.2.1
  - @amodalai/runtime-app@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies [[`dcb5094`](https://github.com/amodalai/amodal/commit/dcb5094fa382ef47b33fbe1bc8a36c31084ef654), [`4c3d572`](https://github.com/amodalai/amodal/commit/4c3d5722e263bf6dda2dba93f29427d06615fbd3), [`8ebccd3`](https://github.com/amodalai/amodal/commit/8ebccd30eacf3d97ea28c4c5199a862361918cd2), [`cf08296`](https://github.com/amodalai/amodal/commit/cf08296efbe1655125dc8b4059bdf426ef324ee1), [`baa667d`](https://github.com/amodalai/amodal/commit/baa667d4dd783a105516d0c82b68c7c660dd2611), [`60076b0`](https://github.com/amodalai/amodal/commit/60076b056cba9cf967d99b49d767391561e06573), [`ea3bd16`](https://github.com/amodalai/amodal/commit/ea3bd166b79f900a4f5e941cf77fe8dcaf1ae638), [`db615b2`](https://github.com/amodalai/amodal/commit/db615b2f30ee91381c9b538b2c6c71606964b8b5), [`42d1947`](https://github.com/amodalai/amodal/commit/42d194773515d196992cf9586819333b64d6187e), [`21fa374`](https://github.com/amodalai/amodal/commit/21fa374bc69e3219123735a990545cb1399165c4), [`4678842`](https://github.com/amodalai/amodal/commit/4678842c361e87baaef0eefe2745a9348ad34377), [`756c452`](https://github.com/amodalai/amodal/commit/756c452c8da34647c02ab66dd5816207003c97e3), [`95492b6`](https://github.com/amodalai/amodal/commit/95492b611e5626a22d0dd782ca91e18750ac0f0e), [`fa5136e`](https://github.com/amodalai/amodal/commit/fa5136e5f18e9579be7ed6e34d6b296ee2fbd5a2), [`0667c26`](https://github.com/amodalai/amodal/commit/0667c265b113e9f4b59ae214a84dfe492370edf3), [`4e8dde3`](https://github.com/amodalai/amodal/commit/4e8dde3678457974e08f3bf21405525f6fa322c1), [`1b8c30a`](https://github.com/amodalai/amodal/commit/1b8c30a687b245e15dbb01bdced605e43e454e1a), [`c2d02c5`](https://github.com/amodalai/amodal/commit/c2d02c5447a203652fd1cb338f58c28e643654e2), [`360f9cd`](https://github.com/amodalai/amodal/commit/360f9cd70e004ca7a6bd0db70b31ba60715bb66e), [`77b41db`](https://github.com/amodalai/amodal/commit/77b41db64dc4b030ee774eaaf80d02fc222de5b0), [`4a7b781`](https://github.com/amodalai/amodal/commit/4a7b781279f0a15a222c9d40079e18965b437072), [`2fa8f2a`](https://github.com/amodalai/amodal/commit/2fa8f2a859fc7bb1dd632a26d933b4d4c1136185), [`eb24402`](https://github.com/amodalai/amodal/commit/eb24402b712f637f791035aa18113c096c99a452), [`f8a8781`](https://github.com/amodalai/amodal/commit/f8a8781cb61afa20c3d57efff4df8c06f18e1111)]:
  - @amodalai/runtime@0.2.0
  - @amodalai/core@0.2.0
  - @amodalai/types@0.2.0
  - @amodalai/runtime-app@0.2.0

## 0.1.26

### Patch Changes

- [#111](https://github.com/amodalai/amodal/pull/111) [`5b01f5e`](https://github.com/amodalai/amodal/commit/5b01f5e57792c94e51c286c7772095354684fdc8) Thanks [@gte620v](https://github.com/gte620v)! - Create @amodalai/types package with shared type definitions extracted from @amodalai/core. Zero runtime dependencies. Core re-exports all types for backward compatibility.

- Updated dependencies [[`5b01f5e`](https://github.com/amodalai/amodal/commit/5b01f5e57792c94e51c286c7772095354684fdc8), [`73b9cdc`](https://github.com/amodalai/amodal/commit/73b9cdc0cdb781bd61ab65f24e49663af8cabe4d), [`5165f4b`](https://github.com/amodalai/amodal/commit/5165f4bf0d4ea7eb88b7803193b01131769bb3c8), [`51f0c46`](https://github.com/amodalai/amodal/commit/51f0c4635d86b7280a4006f29f9eb82cc68a75b6), [`08dbc02`](https://github.com/amodalai/amodal/commit/08dbc02a322feb1673b619126617b094b7397094), [`3bbf563`](https://github.com/amodalai/amodal/commit/3bbf563bc200cefcd29979c549fd325a98bf9d8d)]:
  - @amodalai/types@0.1.26
  - @amodalai/core@0.1.26
  - @amodalai/runtime@0.1.26
  - @amodalai/runtime-app@0.1.26

## 0.1.25

### Patch Changes

- Updated dependencies [[`93f3a8e`](https://github.com/amodalai/amodal/commit/93f3a8ec4e782180ae2fdb8eeb7daf4bdd754f4d), [`d7eeb11`](https://github.com/amodalai/amodal/commit/d7eeb11c32813c45c718cb5a8f2b50bf4ac5abde)]:
  - @amodalai/runtime@0.1.25
  - @amodalai/runtime-app@0.1.25
  - @amodalai/core@0.1.25

## 0.1.24

### Patch Changes

- Updated dependencies [[`c1c4c45`](https://github.com/amodalai/amodal/commit/c1c4c4567f17a18c0d415d3a9dd9421573bdc988)]:
  - @amodalai/runtime@0.1.24
  - @amodalai/core@0.1.24
  - @amodalai/runtime-app@0.1.24

## 0.1.23

### Patch Changes

- Updated dependencies [[`3260629`](https://github.com/amodalai/amodal/commit/32606293bec782c824107834259f287f3e7a4b0a), [`7714733`](https://github.com/amodalai/amodal/commit/77147335bc999f4e5d23a0840a23406b8b62f8e7), [`2351f6f`](https://github.com/amodalai/amodal/commit/2351f6fe807fb4039c1b6d1d67def3e142af1880)]:
  - @amodalai/runtime-app@0.1.23
  - @amodalai/runtime@0.1.23
  - @amodalai/core@0.1.23

## 0.1.22

### Patch Changes

- Updated dependencies [[`efb9a54`](https://github.com/amodalai/amodal/commit/efb9a54bc0095fd71e737d1ef04c5495a4171452), [`ba75ebe`](https://github.com/amodalai/amodal/commit/ba75ebeed040baeba4b82f80d9f42890a60e3d87)]:
  - @amodalai/core@0.1.22
  - @amodalai/runtime@0.1.22
  - @amodalai/runtime-app@0.1.22

## 0.1.21

### Patch Changes

- Updated dependencies [[`f489f19`](https://github.com/amodalai/amodal/commit/f489f19b1e776f53d70b8288ff675c177286377e)]:
  - @amodalai/runtime@0.1.21
  - @amodalai/core@0.1.21
  - @amodalai/runtime-app@0.1.21

## 0.1.20

### Patch Changes

- [#89](https://github.com/amodalai/amodal/pull/89) [`5fa7089`](https://github.com/amodalai/amodal/commit/5fa7089e2ee8ee92432fc3891fa859779507d1bb) Thanks [@whodatdev](https://github.com/whodatdev)! - Rename AmodalRepo to AgentBundle across public APIs: snapshotToRepo → snapshotToBundle, repoProvider → bundleProvider, getRepo → getBundle, updateRepo → updateBundle, SnapshotServerConfig.repo → .bundle, SessionManagerOptions.repo → .bundle. Fix "New chat" button not resetting the chat when already on the chat screen. Fix useAmodalChat reset() not clearing sessionIdRef.

- Updated dependencies [[`5fa7089`](https://github.com/amodalai/amodal/commit/5fa7089e2ee8ee92432fc3891fa859779507d1bb), [`5fa7089`](https://github.com/amodalai/amodal/commit/5fa7089e2ee8ee92432fc3891fa859779507d1bb)]:
  - @amodalai/core@0.1.20
  - @amodalai/runtime@0.1.20
  - @amodalai/runtime-app@0.1.20

## 0.1.19

### Patch Changes

- Updated dependencies [[`fb31766`](https://github.com/amodalai/amodal/commit/fb31766bcd04861f5d51dcffe345383c15909580)]:
  - @amodalai/runtime-app@0.1.19
  - @amodalai/core@0.1.19
  - @amodalai/runtime@0.1.19

## 0.1.18

### Patch Changes

- [#85](https://github.com/amodalai/amodal/pull/85) [`c8b5bae`](https://github.com/amodalai/amodal/commit/c8b5bae686a8225cf80331d339db4c79eaf0009d) Thanks [@whodatdev](https://github.com/whodatdev)! - Remove app_id from client-server protocol. Server resolves app from hostname/auth context.

  Breaking: AmodalProvider no longer accepts appId prop. RuntimeClient no longer sends app_id. SessionCreator and SessionHydrator signatures changed. Chat/task schemas no longer include app_id.

  New: POST /auth/token on local dev returns empty token. useAuth hook replaces useHostedConfig. runtime-app publishes source for hosted builds. CLI deploy triggers remote Fly build.

- Updated dependencies [[`7cac298`](https://github.com/amodalai/amodal/commit/7cac298da6411b0df9bb798aece918aeb6f8faba), [`c8b5bae`](https://github.com/amodalai/amodal/commit/c8b5bae686a8225cf80331d339db4c79eaf0009d)]:
  - @amodalai/runtime-app@0.1.18
  - @amodalai/runtime@0.1.18
  - @amodalai/core@0.1.18

## 0.1.17

### Patch Changes

- Updated dependencies [[`86084ff`](https://github.com/amodalai/amodal/commit/86084ff0435e58bcb0f738ae88ef6179a3278f9d), [`83f08b4`](https://github.com/amodalai/amodal/commit/83f08b48270e24801923c911eb745cdcecf13fa9), [`14ef749`](https://github.com/amodalai/amodal/commit/14ef749ba9ccf3b74dbf86e3959c609682eda198), [`b6aa9f3`](https://github.com/amodalai/amodal/commit/b6aa9f390863ad71545867be40e24587e85eb646), [`0c3c202`](https://github.com/amodalai/amodal/commit/0c3c20207bb92ed1321373e474be83d315c1a1b2), [`fb49f28`](https://github.com/amodalai/amodal/commit/fb49f284bc427e7dc13a0c43653a55a28b23afb3)]:
  - @amodalai/runtime-app@0.1.17
  - @amodalai/runtime@0.1.17
  - @amodalai/core@0.1.17

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

- Updated dependencies [[`407b935`](https://github.com/amodalai/amodal/commit/407b93586178fa19d7c6162f03e259039df336c4), [`f99b2a1`](https://github.com/amodalai/amodal/commit/f99b2a1d836ee4f57a335182897af696bfce9502)]:
  - @amodalai/core@0.1.16
  - @amodalai/runtime@0.1.16
  - @amodalai/runtime-app@0.1.16

## 0.1.15

### Patch Changes

- [#62](https://github.com/amodalai/amodal/pull/62) [`c2298d6`](https://github.com/amodalai/amodal/commit/c2298d614e86491d07c954092d2044b32dd94281) Thanks [@gte620v](https://github.com/gte620v)! - Add admin agent file tools (read, write, delete) for configuring agents via chat. Config UI improvements: sidebar admin toggle, persistent chat, file tree auto-refresh with reload button. Fix runtime-app package.json exports for running from source.

- [#65](https://github.com/amodalai/amodal/pull/65) [`f4f538e`](https://github.com/amodalai/amodal/commit/f4f538ef39f970820dce5955acdd363cc2c56247) Thanks [@whodatdev](https://github.com/whodatdev)! - Refactor runtime app to use deploy-id based config bootstrap. Add useHostedConfig hook that fetches config from the platform API instead of reading server-injected window.**AMODAL_CONFIG**. Load .env from project directory in dev command. Export ./package.json from runtime-app for require.resolve compatibility.

- [#63](https://github.com/amodalai/amodal/pull/63) [`9319d95`](https://github.com/amodalai/amodal/commit/9319d9536a6dac0afa325df49fa9c6f5773f5835) Thanks [@gte620v](https://github.com/gte620v)! - Eval UI on config page, dev workflow improvements (pnpm link, dev:build, -dev version suffix).

- Updated dependencies [[`c2298d6`](https://github.com/amodalai/amodal/commit/c2298d614e86491d07c954092d2044b32dd94281), [`f4f538e`](https://github.com/amodalai/amodal/commit/f4f538ef39f970820dce5955acdd363cc2c56247), [`9319d95`](https://github.com/amodalai/amodal/commit/9319d9536a6dac0afa325df49fa9c6f5773f5835)]:
  - @amodalai/runtime@0.1.15
  - @amodalai/runtime-app@0.1.15
  - @amodalai/core@0.1.15

## 0.1.14

### Patch Changes

- [#61](https://github.com/amodalai/amodal/pull/61) [`f4d5b06`](https://github.com/amodalai/amodal/commit/f4d5b062f738b105568966e6bc51dc1745afe277) Thanks [@gte620v](https://github.com/gte620v)! - Group CLI commands under pkg, deploy, ops, and auth subcommands. 35 top-level commands → 11 entries.

- [#57](https://github.com/amodalai/amodal/pull/57) [`67b8faa`](https://github.com/amodalai/amodal/commit/67b8faaa2e18084b78c5ed29fdbf7467583f4a8d) Thanks [@gte620v](https://github.com/gte620v)! - Fix "Cannot GET /" in `amodal dev`: move runtime-app from optional peer dependency to a real dependency and use Node module resolution to find the SPA assets.

- [#60](https://github.com/amodalai/amodal/pull/60) [`ca4285d`](https://github.com/amodalai/amodal/commit/ca4285d545290ef6c61b0b39d7cfce7ca19e236c) Thanks [@gte620v](https://github.com/gte620v)! - Session rename/delete, rich tool call cards, admin chat split pane, suppress OpenTelemetry warning, init cleanup.

- Updated dependencies [[`ca4285d`](https://github.com/amodalai/amodal/commit/ca4285d545290ef6c61b0b39d7cfce7ca19e236c)]:
  - @amodalai/runtime@0.1.14
  - @amodalai/runtime-app@0.1.14
  - @amodalai/core@0.1.14

## 0.1.13

### Patch Changes

- [#55](https://github.com/amodalai/amodal/pull/55) [`125be18`](https://github.com/amodalai/amodal/commit/125be187872d3091b2ee240054145bcd0fb3a088) Thanks [@gte620v](https://github.com/gte620v)! - Fix "Cannot GET /" in `amodal dev`: move runtime-app from optional peer dependency to a real dependency and use Node module resolution to find the SPA assets.

- Updated dependencies []:
  - @amodalai/core@0.1.13
  - @amodalai/runtime@0.1.13
  - @amodalai/runtime-app@0.1.13

## 0.1.12

### Patch Changes

- [#53](https://github.com/amodalai/amodal/pull/53) [`d645049`](https://github.com/amodalai/amodal/commit/d6450493413c4ae506d22438e0e5e4bfe5484f9a) Thanks [@gte620v](https://github.com/gte620v)! - Add admin agent for config chat. Fetched from registry, cached at ~/.amodal/admin-agent/. Config section defaults to admin chat. Update via `amodal update --admin-agent`.

- Updated dependencies [[`d645049`](https://github.com/amodalai/amodal/commit/d6450493413c4ae506d22438e0e5e4bfe5484f9a)]:
  - @amodalai/core@0.1.12
  - @amodalai/runtime@0.1.12
  - @amodalai/runtime-app@0.1.12

## 0.1.11

### Patch Changes

- [#46](https://github.com/amodalai/amodal/pull/46) [`84ce38f`](https://github.com/amodalai/amodal/commit/84ce38f43b697d2ed6ebbf0ca0e0c85ab8513663) Thanks [@gte620v](https://github.com/gte620v)! - Add config page with Agent, Models, Prompt Inspector, Secrets, and System sections. Gear icon in header navigates to /config. Prompt inspector shows token usage bar, section breakdown, and full compiled prompt.

- [#48](https://github.com/amodalai/amodal/pull/48) [`bfc1e77`](https://github.com/amodalai/amodal/commit/bfc1e772270567037adad08323e6c1ba5035855a) Thanks [@whodatdev](https://github.com/whodatdev)! - Add runtime-app hosting support: fallbackMiddleware option on createServer, CLI deploys repo tarball to build server, logout command, automatic token refresh

- [#49](https://github.com/amodalai/amodal/pull/49) [`26034c6`](https://github.com/amodalai/amodal/commit/26034c6ac223b0e203f59ab820858ff3e3fe47de) Thanks [@gte620v](https://github.com/gte620v)! - Untyped package registry with dependency resolution. Packages are bundles that can contain any combination of connections, skills, automations, knowledge, stores, tools, pages, and agents. Lock file keyed by npm name. npm handles transitive dependency resolution. CLI simplified: `amodal install <name>` instead of `amodal install <type> <name>`.

- Updated dependencies [[`61ab675`](https://github.com/amodalai/amodal/commit/61ab67585161c751772c89126d2fa1e8fe03ce8a), [`84ce38f`](https://github.com/amodalai/amodal/commit/84ce38f43b697d2ed6ebbf0ca0e0c85ab8513663), [`bfc1e77`](https://github.com/amodalai/amodal/commit/bfc1e772270567037adad08323e6c1ba5035855a), [`fe4785d`](https://github.com/amodalai/amodal/commit/fe4785d0106eb39583b64b282bb89522dcaf92ef), [`26034c6`](https://github.com/amodalai/amodal/commit/26034c6ac223b0e203f59ab820858ff3e3fe47de)]:
  - @amodalai/runtime@0.1.11
  - @amodalai/runtime-app@0.1.11
  - @amodalai/core@0.1.11

## 0.1.10

### Patch Changes

- [#38](https://github.com/amodalai/amodal/pull/38) [`4840b56`](https://github.com/amodalai/amodal/commit/4840b56219db2b499a740bd1477b8f7365f205f8) Thanks [@gte620v](https://github.com/gte620v)! - Automations page with Run Now button, run history tracking, and improved API. Shows title, prompt, schedule, trigger type, last run status. Run Now waits for completion and shows success/error.

- [#40](https://github.com/amodalai/amodal/pull/40) [`f12d716`](https://github.com/amodalai/amodal/commit/f12d7164a0190d33616414550c36b1d9610c2e22) Thanks [@gte620v](https://github.com/gte620v)! - Entity list redesign (card layout with smart field picking), dark mode for all entity components, remove chat bubble, sort automations alphabetically, add pre-push hook blocking direct pushes to main.

- [#42](https://github.com/amodalai/amodal/pull/42) [`e9453a3`](https://github.com/amodalai/amodal/commit/e9453a30a2084441868efc3d5833817e860911f6) Thanks [@gte620v](https://github.com/gte620v)! - Fix: inspect detail endpoints read repo directly instead of creating sessions (which triggered MCP reconnections). Render skill body as markdown.

- Updated dependencies [[`4840b56`](https://github.com/amodalai/amodal/commit/4840b56219db2b499a740bd1477b8f7365f205f8), [`e9453a3`](https://github.com/amodalai/amodal/commit/e9453a30a2084441868efc3d5833817e860911f6)]:
  - @amodalai/runtime@0.1.10
  - @amodalai/core@0.1.10
  - @amodalai/runtime-app@0.1.10

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
