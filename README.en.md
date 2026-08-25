# dsh-better

> **Unofficial community plugin.** Not affiliated with DeepSeek. Code produced by AI.

Better DSH — a dual-half plugin (host + browser) that follows the DeepSeek Harness plugin conventions and adds four capabilities to the dsh web GUI.

[中文](README.md) · English

## Install

Published on npm — one terminal command installs it into your dsh profile:

```bash
dsh plugin --profile web add dsh-better
```

Restart DSH afterwards and the "Better DSH" entry appears in Settings.

## Features

Settings → Better DSH:

- **Archived sessions** — lists every archived conversation; restore any of them to its original workspace slot, or delete the archive for good;
- **Task notifications** — while the page stays open, stopped tasks raise native system notifications (Windows toast / macOS / Linux desktop): when the agent asks a question or offers options, when a task completes, and when it stops with an error;
- **Update checker** — compares your build against the latest release (full semver rules); ships two copy-ready command groups, the npm one (`npm install -g @deepseek-ai/dsh@latest`, `npx @deepseek-ai/dsh@latest web`) and a source-build one, and can pop up an independent terminal window at your checkout for you to paste them into;
- **Model routing** — keyword rules match user messages in order; on a hit, the current session is switched to the configured provider / model / reasoning effort, exact-validated against the live DSH registry before anything is written. An optional `model_route` tool lets the agent switch models on its own, strictly within an explicit allowlist (design ported from [dsh-model-router](https://github.com/superboy911/dsh-model-router), trimmed to what was needed).

Every configuration change applies live — no restart needed.

## Feedback

Running into anything — install trouble, UI glitches, silent notifications, routing not kicking in… — or just have an idea? Please open an [Issue](https://github.com/wackyju2-beep/dsh-better/issues); more reports are always welcome. The more specific the report (DSH version, OS, steps to reproduce), the faster the fix.
