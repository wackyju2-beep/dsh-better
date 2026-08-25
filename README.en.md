# dsh-better

> **Unofficial community plugin.** Not affiliated with DeepSeek. Code produced by AI.

Better DSH — a dual-half plugin (host + browser) that follows the DeepSeek Harness plugin conventions and adds a few handy tools to the dsh web GUI: archived-session management, system-level task notifications, an update checker and model routing. Everything lives under Settings → Better DSH, ready to use right after install.

[中文](README.md) · English

## Install

Published on npm — one terminal command installs it into your dsh profile:

```bash
dsh plugin --profile web add dsh-better
```

Restart DSH afterwards and the "Better DSH" entry appears in Settings.

## Features

### Archived sessions

Archived conversations never disappear — the stock UI just can't see them anymore. Here they all are:

- browse each archive's title hints, working directory, archived time and local log state;
- **Restore**: send it back to its original workspace slot and continue chatting;
- **Delete for good**: wipe the archive together with its local log, leaving no ghost entries.

Restores/deletes write straight through the open workspace persistence layer and reuse the gateway's own change events, so every open page converges live — no manual refresh needed.

### Task notifications

While the page stays open, a stopped task raises a **native system notification** (Windows toast / macOS / Linux desktop notification). Three triggers, each individually toggleable:

- the agent asked a question or offered options (waiting for you);
- the task finished normally;
- the task stopped with an error.

Under the hood, session-lifecycle callbacks are wrapped **reversibly** to observe state changes: stopping the plugin restores every wrapped prototype method and clears internal state, leaving no stray observers behind.

### Update checker

Compares your local dsh against the latest GitHub release (full semver rules, prereleases included):

- auto-detects the install kind and checkout directory: walk up from the running entry to the nearest `@deepseek-ai/dsh` package → pnpm global store → conventional-path scan; override manually with the `DSH_BETTER_REPO_ROOT` environment variable;
- ships two copy-ready command groups: the npm one (e.g. `npm install -g @deepseek-ai/dsh@latest`) and the source-build one;
- latest-release facts come through a three-tier chain (Releases API → releases list → cross-host atom feed) with a 5-minute cache, a 24-hour stale fallback and a failure fast path — the panel keeps working when GitHub hiccups;
- pops up an independent terminal window at your checkout with one click; you paste the commands yourself.

### Model routing

Route sessions to a target model by keyword rules (design ported from [dsh-model-router](https://github.com/superboy911/dsh-model-router), trimmed to what was needed):

- rules match user messages in order; the first hit wins, and a miss changes nothing;
- a target is a provider / model / reasoning-effort triple, **exact-validated against the live registry** before anything is written — retired or unknown combos are refused outright;
- an optional `model_route` tool lets the agent switch models mid-conversation, strictly within combinations listed one by one in an allowlist.

Every configuration change applies live — no restart needed.

## How it works

A standard dual-half plugin:

- the **host half** runs inside the Node backend process and registers a set of loopback-only exact API routes; the **browser half** loads per page and injects the UI into the settings screen;
- three security fences: loopback peers only, a `Host` header check (anti DNS-rebinding), and POST bodies must declare `application/json` (a cross-site "simple request" cannot forge that header, and these routes never answer CORS preflights);
- everything is resolved against the running dsh runtime at load time: any missing piece disables just its own feature with a warning instead of breaking backend startup.

And something we're a little proud of: the UI **follows dsh's original design language throughout** — colors, radii, spacing and typography all come from the active theme's semantic tokens, with zero third-party styling. Whatever theme you switch to, it blends in like a built-in page.

## Version history

| Version | Highlights |
| --- | --- |
| v0.1.0 | First release: archived sessions + task notifications |
| v0.2.0 | Update checker (directory discovery chain, three-tier release sources, terminal popup); English docs |
| v0.3.0 | Model routing (ported from [dsh-model-router](https://github.com/superboy911/dsh-model-router)) |
| v0.3.1 | First publish to npm; a round of fixes: reversible notification-engine wrapping, sessions that die mid-question no longer swallow completion notifications, a cross-site request fence (POST must declare JSON), update-check moved off the serial queue with concurrency dedupe and a failure cache |

## Feedback

Running into anything — install trouble, UI glitches, silent notifications, routing not kicking in… — or just have an idea? Please open an [Issue](https://github.com/wackyju2-beep/dsh-better/issues); more reports are always welcome. The more specific the report (DSH version, OS, steps to reproduce), the faster the fix.
