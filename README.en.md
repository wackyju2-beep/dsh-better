# dsh-better

> **Unofficial community plugin.** Not affiliated with DeepSeek. 非官方社区插件，与 DeepSeek 官方无关。Code produced by AI.

Better DSH — a dual-half plugin (host + browser) that follows the DeepSeek Harness plugin conventions and adds four capabilities to the dsh web GUI.

[中文](README.md) · English

## Features

### Archived sessions

Settings → Better DSH → Archived sessions:

- Lists every archived conversation (title, directory, archived time, artifact kind);
- Each row ends with the same "three dots" menu as the sidebar: **Restore** / **Delete**;
- **Restore** removes the session from the global archive set and puts it back in its original workspace slot (archiving never touches workspace bookkeeping, so restoring is a true revert);
- **Delete** removes the local session log file (`.jsonl`) and scrubs the session from every workspace record and the archive set. Live sessions refuse deletion (`session-live`).

The data channel consists of exact routes registered by the host half under `/api/dsh-better/*` (loopback-only); every mutation writes straight to the persisted workspace domain — open browsers converge instantly through the gateway's existing `domain/changed` forwarding, no refresh needed.

### Task notifications

Settings → Better DSH → Task notifications: while the page stays open in the browser, stopped tasks raise **native system notifications** (Windows toasts / macOS Notification Center / Linux freedesktop desktop notifications, with the DeepSeek whale icon; built on the standard browser Notification API, cross-platform by construction):

| Trigger | Notification content |
| --- | --- |
| Agent asks with options / a question | `Options` + numbered option texts |
| Task finishes | Session title + `Completed` (`Stopped` for user aborts) |
| Task stops with an error | `Error` + error message |

- The notification engine observes the event stream by wrapping two frame entry points of the session runtime (observe-only; dispatch is never altered). Subagent child sessions are not re-notified by default.
- Permission, the enable switch, and the three trigger switches live in browser-local storage (localStorage).
- Closing the page naturally stops notifications (an inherent boundary of the browser Notification API).

### Update checker

Settings → Better DSH → Check for updates:

- **Version panel**: installed version, latest release, install kind (source build / packaged install / unknown), checkout directory, and a status light distinguishing "up to date / update available / cannot compare right now"; the latest release carries a "pre-release" badge, its publish date, and a link to the release page;
- Version comparison follows semver rules (`0.1.1-rc.2 < 0.1.1`, numeric prerelease identifiers compared numerically, etc.);
- **Update commands**: `git clone` → `pnpm install` → `pnpm run build` → `pnpm dsh web`, copyable in one click. The UI states clearly that these commands **only apply to a source-built dsh**; packaged installs should upgrade through their package manager instead;
- **Open a terminal at the checkout**: pops up an independent console window for YOU to paste the commands into — the plugin never types anything on your behalf. On Windows it goes through `cmd /c start` so the inner cmd gets a brand-new console (working around the detached-spawn `DETACHED_PROCESS` pitfall where no console is allocated and nothing appears on screen); on macOS it opens Terminal.app; on Linux it tries x-terminal-emulator → gnome-terminal → konsole → xfce4-terminal in order (if none exists it fails with a friendly message and never harms the backend). The window is fully independent of the backend's lifecycle — unmanaged and never terminated by it;
- Latest-release facts come from three sources, first usable one wins:
  1. GitHub API `/releases/latest` (this endpoint excludes prereleases — it 404s while the repository publishes only prereleases);
  2. GitHub API `/releases` list, first non-draft entry (one automatic retry);
  3. The `github.com/<repo>/releases.atom` feed (a different host entirely — an independent path when api.github.com as a whole misbehaves; one automatic retry).

  A success caches for 5 minutes; if every source currently fails but a success happened within the last 24 hours, that older value is served with a "cached data (may be outdated)" badge instead of an error;
- **Checkout auto-discovery** (tried in this order, memoized per process):
  1. The `DSH_BETTER_REPO_ROOT` environment variable (must be a valid source tree);
  2. Walking up from the process entry (`argv[1]`) and the working directory to the nearest `@deepseek-ai/dsh` package.json — hits both source runs and packaged installs;
  3. The pnpm-global store next to the node executable (`<pnpm>/global/*/node_modules/@deepseek-ai/dsh`);
  4. Convention-path scanning `<drive>:\.dsh\deepseek-harness` (C..Z).

### Model routing

Settings → Better DSH → Model routing (design ported from [dsh-model-router](https://github.com/superboy911/dsh-model-router), trimmed to what was needed). The DSH Models page remains the ONLY place to configure providers, credentials, and catalogs; this page owns policy only:

- **Status overview**: engine on/off, enabled rule count, the current session's effective selection (with its source: session header / harness default), the harness default model (read-only), and whether the `model_route` tool is registered;
- **Keyword rule routing**: rules match the user message text in order — first match wins; a miss changes nothing. Each rule = keyword list (comma-separated) → target provider / model / optional reasoning effort. Before any session write the target passes exact validation against the live DSH registry (provider active, model resolvable, effort supported); a failed validation writes nothing. Dormant targets can be saved but never execute;
- **Subagent repair**: subagent sessions skip api-proxy's selection assembly by design, so the engine lazily installs the official selection assembly and keyword rules take effect on the subagent's FIRST request;
- **model_route switch tool** (default off): when enabled, the agent may switch the current session's model on its own — strictly within an explicitly allowlisted set of provider/model/effort entries; every execution still passes live validation. Enabled with an empty allowlist registers no tool. The chat stream shows a route card (applied route + "takes effect on the next assistant message");
- **Editing experience**: the provider dropdown separates Active/Dormant groups, the model input suggests against the official catalog, reasoning-effort options lazy-load per model; every rule has its own enable toggle and an "Apply to this session" button; saves use revision-based optimistic locking with an explicit conflict notice;
- Configuration persists under the dedicated settings namespace `better-model-router` (deliberately distinct from the original plugin's namespace so both can coexist), applies live, and needs no restart.

Implementation note: dsh-better loads through a symlinked directory, so static `import "@deepseek-ai/*"` is impossible; the host half resolves the host modules it needs AT RUNTIME anchored at the process entry (the exact same workspace builds the running app uses). Any unresolvable module degrades only its own feature with a logged explanation — never the rest of the plugin.

