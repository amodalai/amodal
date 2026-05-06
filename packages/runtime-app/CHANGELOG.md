# @amodalai/runtime-app

## 0.3.56

### Patch Changes

- Updated dependencies [29c1c0f]
  - @amodalai/types@0.3.56
  - @amodalai/react@0.3.56

## 0.3.55

### Patch Changes

- @amodalai/types@0.3.55
- @amodalai/react@0.3.55

## 0.3.54

### Patch Changes

- @amodalai/types@0.3.54
- @amodalai/react@0.3.54

## 0.3.53

### Patch Changes

- @amodalai/types@0.3.53
- @amodalai/react@0.3.53

## 0.3.52

### Patch Changes

- Updated dependencies [b0e3a05]
  - @amodalai/react@0.3.52
  - @amodalai/types@0.3.52

## 0.3.51

### Patch Changes

- @amodalai/types@0.3.51
- @amodalai/react@0.3.51

## 0.3.50

### Patch Changes

- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
- Updated dependencies [1a0732b]
  - @amodalai/types@0.3.50
  - @amodalai/react@0.3.50

## 0.3.49

### Patch Changes

- @amodalai/types@0.3.49
- @amodalai/react@0.3.49

## 0.3.48

### Patch Changes

- Updated dependencies [de7d384]
- Updated dependencies [1249171]
  - @amodalai/react@0.3.48
  - @amodalai/types@0.3.48

## 0.3.47

### Patch Changes

- Updated dependencies [ed112ba]
  - @amodalai/react@0.3.47
  - @amodalai/types@0.3.47

## 0.3.46

### Patch Changes

- Updated dependencies [4be518d]
  - @amodalai/react@0.3.46
  - @amodalai/types@0.3.46

## 0.3.45

### Patch Changes

- Updated dependencies [2589dab]
- Updated dependencies [87f5214]
- Updated dependencies [054a9ce]
  - @amodalai/react@0.3.45
  - @amodalai/types@0.3.45

## 0.3.44

### Patch Changes

- e99a932: Studio sidebar reorg, dashboard with cost tracking, sessions page, incremental text streaming, markdown fix, CLI port flags
- Updated dependencies [8909a18]
- Updated dependencies [e99a932]
  - @amodalai/react@0.3.44
  - @amodalai/types@0.3.44

## 0.3.43

### Patch Changes

- @amodalai/types@0.3.43
- @amodalai/react@0.3.43

## 0.3.42

### Patch Changes

- @amodalai/types@0.3.42
- @amodalai/react@0.3.42

## 0.3.41

### Patch Changes

- @amodalai/types@0.3.41
- @amodalai/react@0.3.41

## 0.3.40

### Patch Changes

- Updated dependencies [9a6f63a]
  - @amodalai/react@0.3.40
  - @amodalai/types@0.3.40

## 0.3.39

### Patch Changes

- Updated dependencies [94d2b0d]
  - @amodalai/types@0.3.39
  - @amodalai/react@0.3.39

## 0.3.38

### Patch Changes

- d215ab5: Rebrand from blue to teal accent colors and update logo to new geometric "A" mark
- Updated dependencies [d215ab5]
  - @amodalai/react@0.3.38
  - @amodalai/types@0.3.38

## 0.3.37

### Patch Changes

- @amodalai/types@0.3.37
- @amodalai/react@0.3.37

## 0.3.36

### Patch Changes

- @amodalai/types@0.3.36
- @amodalai/react@0.3.36

## 0.3.35

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.35
  - @amodalai/react@0.3.35

## 0.3.34

### Patch Changes

- Updated dependencies [[`075ff2b`](https://github.com/amodalai/amodal/commit/075ff2b03c9eb20d294469cd9b0dbf86d70d3ad7)]:
  - @amodalai/types@0.3.34
  - @amodalai/react@0.3.34

## 0.3.33

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.33
  - @amodalai/react@0.3.33

## 0.3.32

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.32
  - @amodalai/react@0.3.32

## 0.3.31

### Patch Changes

- [#275](https://github.com/amodalai/amodal/pull/275) [`6d772e6`](https://github.com/amodalai/amodal/commit/6d772e671bc19e82cdbd2a76a30d572ebab4084d) Thanks [@whodatdev](https://github.com/whodatdev)! - Gate all data hooks on token availability. Local dev returns 'local' as token. Queries use token from context, mutations use getToken() with auth check. Auto-refresh on expiry.

- Updated dependencies []:
  - @amodalai/types@0.3.31
  - @amodalai/react@0.3.31

## 0.3.30

### Patch Changes

- [#274](https://github.com/amodalai/amodal/pull/274) [`abf306b`](https://github.com/amodalai/amodal/commit/abf306b92f66f0221820e463d34abec41a18f3b2) Thanks [@whodatdev](https://github.com/whodatdev)! - Use async getToken in session data hooks to prevent 401s on session history requests.

- Updated dependencies [[`3ea984e`](https://github.com/amodalai/amodal/commit/3ea984e4384142e225e8176469fb9db56437fa84)]:
  - @amodalai/types@0.3.30
  - @amodalai/react@0.3.30

## 0.3.29

### Patch Changes

- [#266](https://github.com/amodalai/amodal/pull/266) [`2e1974b`](https://github.com/amodalai/amodal/commit/2e1974b2f3852efab849710856420cd4198347ae) Thanks [@whodatdev](https://github.com/whodatdev)! - Support async getToken for token refresh before chat requests. Fixes intermittent 401 errors on SSE streams when cached tokens expire.

- Updated dependencies [[`2e1974b`](https://github.com/amodalai/amodal/commit/2e1974b2f3852efab849710856420cd4198347ae)]:
  - @amodalai/react@0.3.29
  - @amodalai/types@0.3.29

## 0.3.28

### Patch Changes

- Updated dependencies [[`f794ad9`](https://github.com/amodalai/amodal/commit/f794ad9dfe836d47435d2224917fb9443e1d2af5)]:
  - @amodalai/types@0.3.28
  - @amodalai/react@0.3.28

## 0.3.27

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.27
  - @amodalai/react@0.3.27

## 0.3.26

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.26
  - @amodalai/react@0.3.26

## 0.3.25

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.25
  - @amodalai/react@0.3.25

## 0.3.24

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.24
  - @amodalai/react@0.3.24

## 0.3.23

### Patch Changes

- Updated dependencies [[`c1e515b`](https://github.com/amodalai/amodal/commit/c1e515b81cbb286b2b6f99d39f29eeca08bc8621)]:
  - @amodalai/types@0.3.23
  - @amodalai/react@0.3.23

## 0.3.22

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.22
  - @amodalai/react@0.3.22

## 0.3.21

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.21
  - @amodalai/react@0.3.21

## 0.3.20

### Patch Changes

- [#242](https://github.com/amodalai/amodal/pull/242) [`abb3c8f`](https://github.com/amodalai/amodal/commit/abb3c8f48e546262edb1faeafb6fed05f5199d86) Thanks [@gte620v](https://github.com/gte620v)! - Reconcile ChatWidget and ChatPage: add markdown rendering (react-markdown), image paste, confirmation cards, feedback buttons, and elapsed timer to ChatWidget. Replace runtime-app's custom ChatPage with thin wrapper around ChatWidget. Replace Studio's AdminChat with ChatWidget (custom streamFn support). Delete Studio's duplicate ToolCallCard. Add shared FormattedMarkdown component.

- Updated dependencies [[`abb3c8f`](https://github.com/amodalai/amodal/commit/abb3c8f48e546262edb1faeafb6fed05f5199d86)]:
  - @amodalai/react@0.3.20
  - @amodalai/types@0.3.20

## 0.3.19

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.19
  - @amodalai/react@0.3.19

## 0.3.18

### Patch Changes

- Updated dependencies [[`b8a6c07`](https://github.com/amodalai/amodal/commit/b8a6c07554c31fe2be96e50b5d34409d9877caf6)]:
  - @amodalai/types@0.3.18
  - @amodalai/react@0.3.18

## 0.3.17

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.17
  - @amodalai/react@0.3.17

## 0.3.16

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.16
  - @amodalai/react@0.3.16

## 0.3.15

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.15
  - @amodalai/react@0.3.15

## 0.3.14

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.14
  - @amodalai/react@0.3.14

## 0.3.13

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.13
  - @amodalai/react@0.3.13

## 0.3.12

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.12
  - @amodalai/react@0.3.12

## 0.3.11

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.11
  - @amodalai/react@0.3.11

## 0.3.10

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.10
  - @amodalai/react@0.3.10

## 0.3.9

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.9
  - @amodalai/react@0.3.9

## 0.3.8

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.8
  - @amodalai/react@0.3.8

## 0.3.7

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.7
  - @amodalai/react@0.3.7

## 0.3.6

### Patch Changes

- Updated dependencies [[`9b661e1`](https://github.com/amodalai/amodal/commit/9b661e19200336f2c39872399382dc9f72852f36)]:
  - @amodalai/types@0.3.6
  - @amodalai/react@0.3.6

## 0.3.5

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.5
  - @amodalai/react@0.3.5

## 0.3.4

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.4
  - @amodalai/react@0.3.4

## 0.3.3

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.3
  - @amodalai/react@0.3.3

## 0.3.2

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.2
  - @amodalai/react@0.3.2

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.1
  - @amodalai/react@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.3.0
  - @amodalai/react@0.3.0

## 0.2.10

### Patch Changes

- Updated dependencies []:
  - @amodalai/types@0.2.10
  - @amodalai/react@0.2.10

## 0.2.9

### Patch Changes

- [#187](https://github.com/amodalai/amodal/pull/187) [`8c7ae14`](https://github.com/amodalai/amodal/commit/8c7ae149dff3167c7dca0f2a26f2401143874090) Thanks [@gte620v](https://github.com/gte620v)! - Add role-gated file access and the foundation for the deploy diff view.

  `/api/files` routes (GET tree, GET file, PUT file) now consult the configured `RoleProvider` and gate access by role:
  - `ops` can read/write anything in the repo (subject to existing path-traversal checks)
  - `admin` can read/write only `skills/`, `knowledge/`, and `agents/` directories. Tree response is filtered to those directories.
  - `user` is denied entirely with 403
  - Unauthenticated requests get 401

  Default behavior in `amodal dev` is unchanged because the default `RoleProvider` returns `ops` for everyone.

  Adds a new `DiffView` React component plus a `computeLineDiff` LCS-based line-diff utility (no new dependencies). The component is ready to render unified diffs but is not yet wired into a backend diff endpoint — that comes in a follow-up PR (`/api/workspace/diff` in the cloud repo).

  The `WorkspaceBar`'s "Persist" button now opens a `DeployConfirmModal` that lists the files about to be deployed. The actual line-by-line diffs will be added once the workspace diff endpoint exists in cloud.

- [#186](https://github.com/amodalai/amodal/pull/186) [`12fb676`](https://github.com/amodalai/amodal/commit/12fb6767069df36e1267b77b78de8580ab7adea4) Thanks [@gte620v](https://github.com/gte620v)! - Add role-aware sidebar to runtime-app. New `useMe` hook calls the runtime's `/api/me` endpoint and returns the current user's role (`user`, `admin`, or `ops`). The main Sidebar and AppShell now hide ops-only items (connections, MCP servers, config gear) from non-ops users, and admin-only items (skills, knowledge, automations, stores, pages) from end-users. ConfigLayout redirects non-ops users to the chat. In `amodal dev` everyone is `ops` so the UI is unchanged.

- [#183](https://github.com/amodalai/amodal/pull/183) [`d521402`](https://github.com/amodalai/amodal/commit/d521402ab934f491669c62b6b0c98604fab8681b) Thanks [@gte620v](https://github.com/gte620v)! - Harden workspace editing in the runtime-app: fix discard data inconsistency, surface localStorage quota errors, throw on stale-base restore, add fetch timeouts, replace empty catches with logged catches, replace bare Errors with typed WorkspaceError. Add centralized browser logger at utils/log.ts.

- Updated dependencies []:
  - @amodalai/types@0.2.9
  - @amodalai/react@0.2.9

## 0.2.8

### Patch Changes

- [#181](https://github.com/amodalai/amodal/pull/181) [`e0aed07`](https://github.com/amodalai/amodal/commit/e0aed0786b3f32d6a3482428834384221427cc02) Thanks [@whodatdev](https://github.com/whodatdev)! - Await workspace restore before loading file tree. Adds `ready` state to useWorkspace so ConfigFilesPage waits for localStorage restore to complete before fetching files, preventing stale file tree after server restart.

- Updated dependencies []:
  - @amodalai/types@0.2.8
  - @amodalai/react@0.2.8

## 0.2.7

### Patch Changes

- [#179](https://github.com/amodalai/amodal/pull/179) [`f889144`](https://github.com/amodalai/amodal/commit/f889144a6501de7592ce4bb6416e1a24938fd756) Thanks [@whodatdev](https://github.com/whodatdev)! - Fix workspace localStorage storage and restore on load. useWorkspace now always returns an object so onFileSaved is available before the async config fetch completes.

- Updated dependencies []:
  - @amodalai/types@0.2.7
  - @amodalai/react@0.2.7

## 0.2.6

### Patch Changes

- [#177](https://github.com/amodalai/amodal/pull/177) [`737c888`](https://github.com/amodalai/amodal/commit/737c888a13e7e0cba4f9cc88b5d99f7300984c48) Thanks [@whodatdev](https://github.com/whodatdev)! - Fix workspace localStorage storage and restore on load. Use a ref for config in onFileSaved to prevent stale closure, and restore pending changes from localStorage on mount.

- Updated dependencies []:
  - @amodalai/types@0.2.6
  - @amodalai/react@0.2.6

## 0.2.5

### Patch Changes

- [#175](https://github.com/amodalai/amodal/pull/175) [`7c2a1b3`](https://github.com/amodalai/amodal/commit/7c2a1b39531ea2cb011bf3a89a7d119440e5b55f) Thanks [@whodatdev](https://github.com/whodatdev)! - Add workspace editing UI for hosted runtime (useWorkspace hook, WorkspaceBar component, persist/restore/discard flow). Inert in local/OSS mode.

- Updated dependencies []:
  - @amodalai/types@0.2.5
  - @amodalai/react@0.2.5

## 0.2.4

### Patch Changes

- [#172](https://github.com/amodalai/amodal/pull/172) [`9599b4e`](https://github.com/amodalai/amodal/commit/9599b4e840cef07f3b443b0b2d490d2deabcb517) Thanks [@gte620v](https://github.com/gte620v)! - Add image paste support to chat

  Users can paste images from the clipboard into the chat input. Images show as removable thumbnails before sending, then render in the user message bubble. Vision-capable providers (Anthropic, Google, OpenAI) receive the image; non-vision providers strip it with a warning. Images are stored in a separate `image_data` column to avoid JSONB bloat, with automatic rehydration on session load.

- Updated dependencies [[`0132204`](https://github.com/amodalai/amodal/commit/0132204a35f457e067fc5150a219f264a0f0955c), [`9599b4e`](https://github.com/amodalai/amodal/commit/9599b4e840cef07f3b443b0b2d490d2deabcb517)]:
  - @amodalai/react@0.2.4
  - @amodalai/types@0.2.4

## 0.2.3

### Patch Changes

- Updated dependencies [[`83d0153`](https://github.com/amodalai/amodal/commit/83d01530ae0b85cf7333df75e6fe15cabb1cb63b)]:
  - @amodalai/types@0.2.3
  - @amodalai/react@0.2.3

## 0.2.2

### Patch Changes

- Updated dependencies [[`f4d59ea`](https://github.com/amodalai/amodal/commit/f4d59eae060aa5fa35e1f2f756413457a4d5331b), [`1523d96`](https://github.com/amodalai/amodal/commit/1523d96f2bb1d6b5e2f0023690f9abb371b88fd3), [`a33e080`](https://github.com/amodalai/amodal/commit/a33e0807e6607c88aa203f5dd2c1bf89299026d8)]:
  - @amodalai/types@0.2.2
  - @amodalai/react@0.2.2

## 0.2.1

### Patch Changes

- Updated dependencies [[`745228d`](https://github.com/amodalai/amodal/commit/745228db110b6da50e0514f6dc90250037ada958), [`cdcf62f`](https://github.com/amodalai/amodal/commit/cdcf62f90f42a3a6064f7e86cdcfa0293493e949), [`7d6e825`](https://github.com/amodalai/amodal/commit/7d6e8257b790380ca599c8cb1a0d937bb3741dd1), [`57b143f`](https://github.com/amodalai/amodal/commit/57b143fac3c0de23651dd26a295be9ee553a91d1)]:
  - @amodalai/types@0.2.1
  - @amodalai/react@0.2.1

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.2.0

## 0.1.26

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.1.26

## 0.1.25

### Patch Changes

- [#100](https://github.com/amodalai/amodal/pull/100) [`d7eeb11`](https://github.com/amodalai/amodal/commit/d7eeb11c32813c45c718cb5a8f2b50bf4ac5abde) Thanks [@gte620v](https://github.com/gte620v)! - Add thinking spinner with elapsed timer to all chats. PGLite lock file warns on concurrent access. Postgres backend config support (graceful fallback to PGLite).

- Updated dependencies []:
  - @amodalai/react@0.1.25

## 0.1.24

### Patch Changes

- Updated dependencies []:
  - @amodalai/react@0.1.24

## 0.1.23

### Patch Changes

- [#97](https://github.com/amodalai/amodal/pull/97) [`3260629`](https://github.com/amodalai/amodal/commit/32606293bec782c824107834259f287f3e7a4b0a) Thanks [@gte620v](https://github.com/gte620v)! - Consolidate brand accent colors into CSS custom property design tokens. Add primary-solid variant for dark surfaces. Fix chat bubble and code block readability in both light and dark mode.

- Updated dependencies []:
  - @amodalai/react@0.1.23

## 0.1.22

### Patch Changes

- [#84](https://github.com/amodalai/amodal/pull/84) [`ba75ebe`](https://github.com/amodalai/amodal/commit/ba75ebeed040baeba4b82f80d9f42890a60e3d87) Thanks [@gte620v](https://github.com/gte620v)! - Page metadata for data source dependencies (stores/automations), batch store tool, tool handler TypeScript compilation, tool log telemetry, PGLite write queue and error handling, LOCAL_APP_ID constant, automation inline tool cards, chat ?prompt= param, live sidebar polling, page error boundary.

- Updated dependencies []:
  - @amodalai/react@0.1.22

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
