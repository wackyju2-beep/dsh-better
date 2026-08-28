# dsh-better

> **Unofficial community plugin.** Not affiliated with DeepSeek. Code produced by AI.

Better DSH — a dual-half plugin (host + browser) that follows the DeepSeek Harness plugin conventions and adds a few handy tools to the dsh web GUI: archived-session management, system-level task notifications, an update checker, model routing, and a DeepSeek-style message scroll nav. Everything lives under Settings → Better DSH, ready to use right after install.

[中文](README.md) · English

## Install

Published on npm — one terminal command installs it into your dsh profile:

```bash
dsh plugin --profile web add dsh-better
```

Restart DSH afterwards and the "Better DSH" entry appears in Settings.

## Features

Settings → Better DSH:

- **Archived sessions** — list every archived conversation (title hints, working directory, archived time, local log state); restore it to its original workspace slot and keep chatting, or delete it for good together with its local log;
- **Task notifications** — while the page stays open, a stopped task raises a **native system notification** (Windows toast / macOS / Linux desktop notification): agent question or options, task finished, task errored — each trigger individually toggleable;
- **Update checker** — compares your local dsh against the latest GitHub release (full semver rules); copy-ready update commands, or pop up an independent terminal at your checkout and paste them yourself;
- **Model routing** — keyword rules match user messages in order; the first hit switches the session to the target provider / model / reasoning effort; an optional `model_route` tool lets the agent switch models mid-conversation (design ported from [dsh-model-router](https://github.com/superboy911/dsh-model-router), trimmed to what was needed);
- **Message scroll nav** — a 1:1 port of the [chat.deepseek.com](https://chat.deepseek.com) scroll nav: one tick per message you sent, hover to preview, click to jump; colors customizable in its settings page. **Off by default**; when enabled it takes over from the official built-in turn navigator, and toggling it off restores the official one.

Every configuration change applies live — no restart needed.

## How it works

A standard dual-half plugin: the **host half** runs inside the Node backend process and registers a set of loopback-only `/api/dsh-better/*` exact API routes; the **browser half** loads per page, injects the settings UI, and talks to the host over those routes.

Everything is resolved against the running dsh runtime at load time: dsh-better is loaded through a symlinked directory and cannot statically `import "@deepseek-ai/*"`, so the host half resolves the host modules it needs with the running entry as the anchor — the same build artifacts as the running instance. Any missing piece disables just its own feature with a warning instead of breaking backend startup.

Three security fences: loopback peers only; a `Host` header check (anti DNS-rebinding); and POST bodies must declare `application/json` — a cross-site "simple request" cannot forge that header, and these routes never answer CORS preflights, so a forged page can't touch your archives.

### Archived sessions

- Restores/deletes write straight through the open workspace persistence layer. Archiving never touches workspace bookkeeping, so restoring is exact: remove the session from the global archive set and it lands back in its original workspace slot;
- deleting wipes the local `.jsonl` session log and removes the session from the workspace records and the archive set; a live session refuses deletion (`session-live`);
- every change writes straight into the persisted workspace domain, and the browser converges instantly through the gateway's existing `domain/changed` forwarding — every open page, no manual refresh.

### Task notifications

- Built on the standard browser Notification API — cross-platform by construction (Windows toast / macOS Notification Center / Linux freedesktop desktop notifications, with the DeepSeek whale icon); notifications naturally stop when the page closes, an inherent boundary of that API;
- the notification engine observes the event stream by wrapping two frame entry points of the session runtime, **reversibly**: it only watches from the side and never alters dispatch; stopping the plugin restores every wrapped prototype method and clears internal state (the wrapper carries a marker so re-enabling can't stack layers), leaving no stray observers behind;
- a session that dies while its question is pending no longer swallows completion notifications forever (pending registrations clear when a new run starts); subagent child sessions don't re-notify by default;
- permission, the master toggle and the three trigger toggles live in browser-local localStorage.

### Update checker

- **Directory discovery chain** (memoized in-process): explicit `DSH_BETTER_REPO_ROOT` → walk up from the running entry (`argv[1]`) and cwd to the nearest `@deepseek-ai/dsh` package.json (hits both source runs and packaged installs) → the pnpm global store next to the node executable → a conventional-path scan of `<drive>:\.dsh\deepseek-harness`. A path containing node_modules means "packaged install"; an apps/cli layout means "source build"; the drive scan and pnpm probing are Windows-only and silently skipped on unix;
- **three-tier release sources**, first available wins: `/releases/latest` (that endpoint excludes prereleases — a 404 is expected when every upstream release is a prerelease) → the `/releases` list's first non-draft entry (one retry) → the `github.com/<repo>/releases.atom` feed (a different host — the independent path when api.github.com is down entirely; one retry). Per-request timeout of 9 seconds; successes cache for 5 minutes; if everything fails within 24 hours of a success, the stale value is shown with a "cached data (may be outdated)" badge — stale data beats a blank error;
- update checks run off the shared serial queue, with concurrency dedupe and a failure cache: the panel keeps working when GitHub hiccups, and nothing else gets blocked;
- version comparison follows full semver rules (`0.1.1-rc.2 < 0.1.1`, numeric prerelease identifiers compare numerically); the comparator is exported separately for testing;
- **terminal popup**: on Windows, `cmd /d /s /c start` gives the inner cmd a brand-new console — dodging the pitfall where `detached: true` equals `DETACHED_PROCESS` and a console program gets no console at all; macOS uses `open -a Terminal`; Linux tries x-terminal-emulator / gnome-terminal / konsole / xfce4-terminal in order, using a 250ms error-race to tell a "missing program" from a real launch, with late errors parked on a no-op listener so they can't take the backend down. The window is fully independent of the backend lifecycle, never managed or killed by it; you paste the commands yourself — the plugin never types for you.

### Model routing

- The engine's pure functions — rule matching, target validation — are line-for-line identical to the original [dsh-model-router](https://github.com/superboy911/dsh-model-router); configuration persists in its own settings namespace `better-model-router` (deliberately distinct from the original plugin, so the two can coexist);
- rules match user message text in order, **first hit wins; a miss changes nothing**. Before anything is written, the target is exact-validated against the live DSH registry (provider must be active, model must resolve, reasoning effort must be supported); a failed validation writes nothing; dormant targets can be saved but never execute;
- subagent sessions don't apply session-header selections by default; the engine lazily installs the official selection assembly so keyword rules take effect on the subagent's first request;
- the optional `model_route` tool (off by default): once enabled, the agent may switch the current session's model mid-conversation, strictly within combinations listed one by one in an allowlist, and every execution is re-validated live; with an empty allowlist no tool is registered; the chat stream shows a matching routing card;
- read-only routes run off the shared serial queue, rule targets validate in parallel, and upstream requests carry timeout caps — opening the routing page never drags the rest down; saves use a version-number optimistic lock and clearly report conflicts when the config changed in another window.

### Message scroll nav

> **The official build now ships its own (off by default since v0.4.1)**: dsh 0.1.2-alpha.1 includes a built-in turn navigator (the per-turn tick rail at the conversation's right edge). This feature became an optional enhancement — off by default, leaving the official navigator untouched; once enabled, it temporarily hides the official navigator only while the tick rail is actually showing (conversation overflows and user messages are loaded), and the official one returns automatically whenever the toggle is off or the rail is dormant — no dead zone where both are invisible. The jump now uses the same mechanics as the official turn navigator (one instant position write, honored by the official scroll ledger), which also retires the long-standing "jump dragged back to the bottom while streaming" bug for good. The toggle applies live — no page reload needed.

- The scroll nav's class names and layout were reverse-engineered from chat.deepseek.com's production stylesheet and rebuilt 1:1 as a blurred pill track;
- ticks derive straight from the conversation snapshot: each `user` / `steering` (mid-run interjection) chat node maps to one tick, aligned by a stable anchor key onto the rendered message row;
- one long-lived listener maintains every DOM-derived bit: the scroll listener binds once via capture-phase delegation (scrolls from any element reach it, and a scrollport swapped in mid-session retargets on its very first scroll), with a `ResizeObserver` following layout changes; the currently-read position is computed synchronously on every scroll — deliberately no rAF, which freezes in backgrounded windows and would leave the active tick stale;
- clicking a tick scrolls the conversation scrollport onto the matching message row instantly — the same mechanism the official turn navigator uses (a single scrollTop write; the official scroll ledger classifies it as programmatic rather than reader input and disengages bottom-follow on its own); the old 5-second heartbeat guard retired together with the official scroll-system rewrite;
- hiding the official navigator never relies on build-time class names (officials are CSS-module hashes) — only the `nav` element inside the official scroll container; the plugin's own rail carries a dedicated marker and can never be caught by its own rule;
- theme colors ride CSS `light-dark()` to follow light/dark automatically; custom colors persist in browser-local localStorage and apply live.

And something we're a little proud of: the UI **follows dsh's original design language throughout** — colors, radii, spacing and typography all come from the active theme's semantic tokens, with zero third-party styling. Whatever theme you switch to, it blends in like a built-in page.

## Version history

| Version | Highlights |
| --- | --- |
| v0.1.0 | First release: archived sessions + task notifications |
| v0.2.0 | Update checker (directory discovery chain, three-tier release sources, terminal popup); English docs |
| v0.3.0 | Model routing (ported from [dsh-model-router](https://github.com/superboy911/dsh-model-router)) |
| v0.3.2 | First publish to npm; a round of fixes: reversible notification-engine wrapping, sessions that die mid-question no longer swallow completion notifications, a cross-site request fence (POST must declare JSON), update-check moved off the serial queue with concurrency dedupe and a failure cache, and model-routing hardening (upstream timeout caps, read-only routes off the serial queue, parallel rule validation, working in-subagent model switches, session-selection echo after save) |
| v0.4.0 | Message scroll nav: chat.deepseek.com-style user-message ticks (hover to preview, click to jump) with customizable colors |
| v0.4.1 | Adapted to the official 0.1.2-alpha.1 built-in turn navigator: the scroll nav is now off by default; enabling it temporarily takes over from the official navigator and toggling it off restores it; jumps use the official instant-write semantics, retiring the 5-second heartbeat guard |

## Feedback

Running into anything — install trouble, UI glitches, silent notifications, routing not kicking in… — or just have an idea? Please open an [Issue](https://github.com/wackyju2-beep/dsh-better/issues); more reports are always welcome. The more specific the report (DSH version, OS, steps to reproduce), the faster the fix.
