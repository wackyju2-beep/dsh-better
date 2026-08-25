/**
 * dsh-better — host half.
 *
 * Registers five loopback-only endpoints on the web server that the shipped
 * gateway deliberately does not expose, so the browser half can manage
 * archived sessions and check for harness updates:
 *
 *   GET  /api/dsh-better/archived     — every archived session with its header facts
 *   POST /api/dsh-better/restore      — unarchive one session (back to its workspace slot)
 *   POST /api/dsh-better/delete       — delete one archived session's local log and registry rows
 *   GET  /api/dsh-better/update-check — installed dsh facts vs the latest GitHub release
 *   POST /api/dsh-better/open-terminal— open a user-visible console window at the checkout root
 *
 * Model routing (v0.3.0, ported from the dsh-model-router design):
 *
 *   GET  /api/dsh-better/model-router        — policy snapshot (config, revision, provider
 *                                              directory, catalogs, default model, effective
 *                                              selection for ?sessionId=)
 *   GET  /api/dsh-better/model-router/efforts— reasoning efforts for one provider/model pair
 *   POST /api/dsh-better/model-router/save   — persist the whole config (revision conflict → 409)
 *   POST /api/dsh-better/model-router/apply  — write one validated route to a live session header
 *
 * The routing engine listens on `agent/inbox/inserted`: ordered keyword rules,
 * first match wins, a miss changes nothing; targets pass exact validation
 * against the live DSH llm registry BEFORE any session write. The optional
 * `model_route` agent tool lets the model switch the session model strictly
 * within a user-configured allowlist. Config persists under the settings
 * namespace `better-model-router` (deliberately distinct from the original
 * plugin's namespace so both can coexist).
 *
 * Host helpers (`canonicalHeader`, the schemastery fork, …) cannot be imported
 * statically: dsh-better loads through a symlinked local-plugins directory and
 * Node resolves its realpath, so bare `@deepseek-ai/*` specifiers would miss.
 * Instead every helper resolves AT RUNTIME against the running application —
 * createRequire anchored at process.argv[1] (the tsx source entry AND the
 * packaged bin alike), with the resolved dsh-settings directory bridging to
 * the vendored schemastery fork. Resolved copies are the exact workspace
 * builds the host itself runs on; any unresolvable piece degrades its feature
 * with a warning instead of failing the plugin.
 *
 * The endpoints live under the /api prefix as EXACT routes, so they win over
 * the connection plugin's /api prefix handler; each handler applies its own
 * peer-socket loopback fence. This mirrors the proven community-plugin route
 * posture (dsh-usage-stats).
 *
 * The update checker discovers the running dsh installation without any
 * machine-specific configuration: it walks up from `process.argv[1]` (and then
 * cwd) to the nearest `@deepseek-ai/dsh` package.json — a source checkout when
 * the path leaves node_modules behind, a packaged install otherwise — falls
 * back to the pnpm-global store next to `process.execPath`, and finally scans
 * `<drive>:\.dsh\deepseek-harness` for a source tree. `DSH_BETTER_REPO_ROOT`
 * overrides the discovered checkout directory. Latest-release facts come from
 * the GitHub REST API with a short in-memory cache; failures degrade to an
 * explicit `latestError` instead of hiding the installed side.
 *
 * open-terminal deliberately does NOT use ctx.subprocess: that service owns
 * piped/managed process trees and terminates them on disposal, while this
 * endpoint must leave an independent, user-visible console window behind. It
 * spawns a detached cmd.exe (or the platform terminal) that the harness never
 * tracks.
 *
 * Restore/delete mutate the durable workspace domain through the OPEN domain
 * handle (`ctx.storageDomain.get('workspace')`): every write emits the same
 * `domain/changed` events the gateway already forwards as
 * `host/archived-sessions-changed` / `host/workspace-changed`, so open
 * browsers converge live with no extra channel.
 *
 * The WorkspaceRegistry keeps its own in-memory copy of the domain state, so
 * after each successful mutation this plugin restarts the workspace loader
 * entry once; its re-init re-reads the medium and every dependent (the API
 * gateway) reloads through cordis itself. Browsers reconnect with backoff and
 * re-baseline from `workspace.list`. Without the restart, a later
 * `workspace.archiveSession` would write the stale cached archive set back
 * over the mutation.
 *
 * @module dsh-better
 */

import { unlink, readFile, stat, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, basename, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/** Stable Cordis plugin name. */
const name = "dsh-better";

/** Services required before this plugin activates. */
const inject = ["webServer", "storageDomain", "loader", "sessionPersistence", "sessions", "settings", "llm", "agents", "tools"];

const LIST_PATH = "/api/dsh-better/archived";
const RESTORE_PATH = "/api/dsh-better/restore";
const DELETE_PATH = "/api/dsh-better/delete";
const UPDATE_PATH = "/api/dsh-better/update-check";
const TERMINAL_PATH = "/api/dsh-better/open-terminal";
const ROUTER_SNAPSHOT_PATH = "/api/dsh-better/model-router";
const ROUTER_EFFORTS_PATH = "/api/dsh-better/model-router/efforts";
const ROUTER_SAVE_PATH = "/api/dsh-better/model-router/save";
const ROUTER_APPLY_PATH = "/api/dsh-better/model-router/apply";

/** Settings namespace owned by the model routing feature (NOT the original plugin's). */
const ROUTER_SETTINGS_NS = "better-model-router";

/** Upstream release facts for the update checker. */
const RELEASES_LATEST_API = "https://api.github.com/repos/deepseek-ai/deepseek-harness/releases/latest";
const RELEASES_LIST_API = "https://api.github.com/repos/deepseek-ai/deepseek-harness/releases?per_page=10";
const RELEASES_ATOM = "https://github.com/deepseek-ai/deepseek-harness/releases.atom";
const RELEASES_PAGE = "https://github.com/deepseek-ai/deepseek-harness/releases";
/** The npm name of the running application. */
const APP_PACKAGE = "@deepseek-ai/dsh";

/** Domain name declared by @deepseek-ai/dsh-workspace's defineDomain spec. */
const WORKSPACE_DOMAIN = "workspace";

/** Loader module names the workspace registry row resolves to. */
const WORKSPACE_ENTRY_NAMES = new Set(["@deepseek-ai/dsh-workspace", "workspace"]);

/** Request body cap: these payloads are one session id. */
const MAX_BODY_BYTES = 64 * 1024;

// ── wire helpers ─────────────────────────────────────────────────────────────

/** Write a JSON response. */
function json(res, status, value) {
	const body = JSON.stringify(value);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-cache"
	});
	res.end(body);
}

/**
 * Loopback fence, primary on the PEER SOCKET address (not the
 * client-controllable Host header); the Host header is an additional check.
 * Same posture as the community plugins' exact routes, which bypass the RPC
 * trust fence by construction.
 */
function isLoopbackAddress(address) {
	if (typeof address !== "string") return false;
	const a = address.toLowerCase();
	if (a === "::1") return true;
	const ipv4 = a.startsWith("::ffff:") ? a.slice(7) : a;
	const octets = ipv4.split(".");
	return octets.length === 4 && octets[0] === "127" && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function hostNameOf(value) {
	if (typeof value !== "string") return null;
	const host = value.trim().toLowerCase();
	if (host.startsWith("[")) {
		const close = host.indexOf("]");
		if (close <= 1) return null;
		const suffix = host.slice(close + 1);
		if (suffix !== "" && !/^:\d+$/.test(suffix)) return null;
		return host.slice(1, close);
	}
	const firstColon = host.indexOf(":");
	const lastColon = host.lastIndexOf(":");
	if (firstColon !== lastColon) return host;
	if (lastColon === -1) return host.replace(/\.$/, "");
	if (!/^\d+$/.test(host.slice(lastColon + 1))) return null;
	return host.slice(0, lastColon).replace(/\.$/, "");
}

function isLoopbackHostHeader(req) {
	const name2 = hostNameOf(req.headers.host);
	return name2 === "localhost" || isLoopbackAddress(name2);
}

/**
 * Refuse non-loopback callers and wrong methods before any work.
 * @returns true when the request was REJECTED (response already written).
 */
function rejectForeignCaller(req, res, method) {
	if (req.method !== method) {
		res.writeHead(405, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ ok: false, error: "method-not-allowed" }));
		return true;
	}
	const peer = req.socket?.remoteAddress;
	if (!(isLoopbackAddress(peer) && isLoopbackHostHeader(req))) {
		json(res, 403, { ok: false, error: "forbidden" });
		return true;
	}
	// POST handlers accept JSON bodies only. Demanding the header closes the
	// cross-site "simple request" hole: a forged application/json body would
	// need a CORS preflight, and these exact routes never answer one.
	if (method !== "GET" && !String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
		json(res, 415, { ok: false, error: "content-type-required" });
		return true;
	}
	return false;
}

/** Read and parse one JSON body, capped; rejects with a plain Error on overflow/malformed input. */
function readJsonBody(req) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > MAX_BODY_BYTES) {
				reject(new Error("body-too-large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				const text = Buffer.concat(chunks).toString("utf8");
				resolve(text === "" ? {} : JSON.parse(text));
			} catch (error) {
				reject(new Error("malformed-json"));
			}
		});
		req.on("error", reject);
	});
}

// ── workspace domain access ──────────────────────────────────────────────────

/** The open workspace domain handle, or undefined when the registry has not opened it yet. */
function workspaceDomain(ctx) {
	try {
		return ctx.storageDomain.get(WORKSPACE_DOMAIN) ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * Restart the workspace registry loader entry once, so its in-memory state
 * matches the medium again. Failures are logged, never thrown: the durable
 * state is already correct and the next boot converges regardless.
 */
async function restartWorkspaceRegistry(ctx) {
	try {
		let entry;
		for (const candidate of ctx.loader.entries()) {
			if (candidate.options?.group) continue;
			if (WORKSPACE_ENTRY_NAMES.has(candidate.options?.name) || candidate.id === "workspace") {
				entry = candidate;
				break;
			}
		}
		if (entry === undefined || entry.fiber === undefined) {
			ctx.logger?.warn?.("dsh-better: workspace registry entry not found; restart skipped");
			return false;
		}
		await entry.fiber.restart();
		return true;
	} catch (error) {
		ctx.logger?.warn?.(`dsh-better: workspace registry restart failed (${String(error)}); the durable state stays correct and converges on next boot`);
		return false;
	}
}

/**
 * Header index over persistence. A failing listing degrades metadata only
 * (the ids themselves still come from the durable archive set); the failure
 * surfaces through `listError` so callers can label degraded rows honestly.
 */
async function headerIndex(ctx) {
	const headers = new Map();
	try {
		for (const header of await ctx.get("sessionPersistence").list()) {
			headers.set(String(header.id), header);
		}
		return { headers, listError: undefined };
	} catch (error) {
		ctx.logger?.warn?.(`dsh-better: sessionPersistence.list failed: ${String(error)}`);
		return { headers, listError: String(error) };
	}
}

// ── operations (serialized per plugin instance) ──────────────────────────────

let operationTail = Promise.resolve();

/** Run one mutating operation serialized against the others. */
function enqueue(operation) {
	const result = operationTail.then(operation, operation);
	operationTail = result.then(() => {}, () => {});
	return result;
}

/** List archived sessions with their local artifact facts. */
async function listArchived(ctx) {
	const domain = workspaceDomain(ctx);
	if (domain === undefined) return { status: 503, body: { ok: false, error: "domain-unavailable" } };
	const state = domain.global.get();
	const { headers, listError } = await headerIndex(ctx);
	const items = [];
	for (const id of state.archivedSessionIds) {
		const sid = String(id);
		const header = headers.get(sid);
		let artifact;
		if (header !== undefined) {
			try {
				const location = ctx.get("sessionPersistence").locate(header);
				if (location !== undefined) artifact = { kind: location.kind };
			} catch {
				// locate is a hint only; absence degrades to no-artifact.
			}
		}
		items.push({
			id: sid,
			headerFound: header !== undefined,
			cwd: header?.cwd,
			createdAt: typeof header?.createdAt === "number" ? new Date(header.createdAt).toISOString() : undefined,
			artifact,
		});
	}
	return { status: 200, body: { ok: true, items, ...(listError === undefined ? {} : { listError }) } };
}

/** Remove one session from the durable archive set (its workspace slot is untouched). */
async function restoreArchived(ctx, sessionId) {
	const domain = workspaceDomain(ctx);
	if (domain === undefined) return { status: 503, body: { ok: false, error: "domain-unavailable" } };
	const sid = String(sessionId ?? "");
	if (sid === "") return { status: 400, body: { ok: false, error: "session-required" } };
	const state = domain.global.get();
	const archived = state.archivedSessionIds.map((value) => String(value));
	if (!archived.includes(sid)) return { status: 404, body: { ok: false, error: "not-archived" } };
	await domain.global.set({
		...state,
		archivedSessionIds: state.archivedSessionIds.filter((value) => String(value) !== sid),
	});
	const restarted = await restartWorkspaceRegistry(ctx);
	return { status: 200, body: { ok: true, restarted } };
}

/** Delete one archived session: local log artifact first, then every registry row naming it. */
async function deleteArchived(ctx, sessionId) {
	const domain = workspaceDomain(ctx);
	if (domain === undefined) return { status: 503, body: { ok: false, error: "domain-unavailable" } };
	const sid = String(sessionId ?? "");
	if (sid === "") return { status: 400, body: { ok: false, error: "session-required" } };

	// A live session owns in-memory writers; refuse rather than fight them.
	const sessions = ctx.get("sessions");
	if (sessions !== undefined && sessions.get(sid) !== undefined) {
		return { status: 409, body: { ok: false, error: "session-live" } };
	}

	// An orphaned id (the archive set names it, persistence does not) is exactly
	// the deleted state plus a stale registry entry: skip artifact work and let
	// the scrub below finish the job.
	const persistence = ctx.get("sessionPersistence");
	const { headers } = await headerIndex(ctx);
	const header = headers.get(sid);

	let removedArtifact = false;
	if (header !== undefined) {
		if (!persistence.supportsRawArtifacts) {
			return { status: 501, body: { ok: false, error: "backend-has-no-artifacts" } };
		}
		const location = persistence.locate(header);
		if (location !== undefined) {
			try {
				await unlink(location.path);
				removedArtifact = true;
			} catch (error) {
				// An already-absent artifact is the deleted state itself; any other
				// storage fault must stop the deletion so the UI can show it.
				if (error?.code !== "ENOENT") {
					return { status: 500, body: { ok: false, error: "artifact-delete-failed", message: String(error) } };
				}
			}
		}
	}

	// Registry scrub: drop the membership slot from every workspace record, then
	// the archive-set entry. Both writes emit domain/changed, so open browsers
	// see the removal before the reply lands.
	const table = domain.table("workspaces");
	for (const [workspaceId, record] of table.entries()) {
		if (!record.sessionIds.some((value) => String(value) === sid)) continue;
		await table.update(workspaceId, (current) => ({
			...current,
			sessionIds: current.sessionIds.filter((value) => String(value) !== sid),
			updatedAt: new Date().toISOString(),
		}));
	}
	const state = domain.global.get();
	await domain.global.set({
		...state,
		archivedSessionIds: state.archivedSessionIds.filter((value) => String(value) !== sid),
	});

	const restarted = await restartWorkspaceRegistry(ctx);
	return { status: 200, body: { ok: true, removedArtifact, restarted } };
}

// ── install discovery (update checker) ───────────────────────────────────────

/** Injectable seams for the offline smoke tests; production code never reassigns. */
const hooks = {
	/** Defaults to globalThis.fetch at call time so tests can stub it. */
	fetch: (url, init) => globalThis.fetch(url, init),
	/** Opens a user-visible terminal window at `dir`; resolves with best-effort facts. */
	spawnTerminal: defaultSpawnTerminal,
	/** Test seam: clear every module-level memo (release cache, install discovery). */
	reset() {
		releaseCache = undefined;
		installInfoCache = undefined;
	},
	/** Test seam: pre-seed the runtime app-module cache the router resolves through. */
	seedAppModule(spec, mod) {
		appModuleCache.set(spec, mod);
	},
	clearAppModules() {
		appModuleCache.clear();
	},
};

async function pathExists(path) {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/** Parse `<dir>/package.json`, or undefined when absent/unreadable/malformed. */
async function manifestAt(dir) {
	try {
		return JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
	} catch {
		return undefined;
	}
}

function stripLeadingV(value) {
	return typeof value === "string" ? value.replace(/^[vV]/, "").trim() : value;
}

/**
 * Release tags carry a `dsh-` prefix on top of the semver `v`
 * (`dsh-v0.1.1-rc.2`); normalize to the bare version for comparisons.
 */
function normalizeReleaseTag(tag) {
	return stripLeadingV(String(tag ?? "").replace(/^dsh-/i, ""));
}

/**
 * Walk up from `startDir` to the nearest directory whose package.json is the
 * dsh application itself. Bounded hops; drive roots terminate the walk.
 */
async function walkUpToAppPackage(startDir) {
	let dir = resolve(startDir);
	for (let hop = 0; hop < 12; hop += 1) {
		const manifest = await manifestAt(dir);
		if (manifest !== undefined && manifest.name === APP_PACKAGE) return { dir, manifest };
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
	return undefined;
}

/**
 * Classify one located @deepseek-ai/dsh package: under node_modules it is a
 * packaged install with no checkout; otherwise it should sit at
 * `<repoRoot>/apps/cli` of a source tree, verified by workspace markers.
 */
async function classifyAppPackage(found, via) {
	const version = typeof found.manifest.version === "string" && found.manifest.version !== ""
		? found.manifest.version
		: undefined;
	if (found.dir.split(/[\\/]+/).includes("node_modules")) {
		return { version, installKind: "packaged", root: null, via };
	}
	const repoRoot = resolve(found.dir, "..", "..");
	const markers = await Promise.all([
		pathExists(join(repoRoot, "pnpm-workspace.yaml")),
		pathExists(join(repoRoot, ".git")),
	]);
	const root = markers.some(Boolean) ? repoRoot : null;
	return { version, installKind: "source", root, via };
}

/** A directory counts as a source tree only when its CLI app package matches. */
async function isValidSourceTree(dir) {
	const manifest = await manifestAt(join(dir, "apps", "cli"));
	return manifest !== undefined && manifest.name === APP_PACKAGE;
}

/**
 * Packaged-install fallback: the pnpm-global store layout next to the running
 * node executable (`<pnpm>/bin/node.exe` → `<pnpm>/global/<ver>/node_modules/@deepseek-ai/dsh`).
 */
async function pnpmGlobalInstall() {
	try {
		const binDir = dirname(process.execPath);
		if (basename(binDir).toLowerCase() !== "bin") return undefined;
		const pnpmRoot = resolve(binDir, "..", "..");
		if (basename(pnpmRoot).toLowerCase() !== "pnpm") return undefined;
		const globalDir = join(pnpmRoot, "global");
		for (const entry of await readdir(globalDir)) {
			const dir = join(globalDir, entry, "node_modules", "@deepseek-ai", "dsh");
			const manifest = await manifestAt(dir);
			if (manifest !== undefined && manifest.name === APP_PACKAGE) return { dir, manifest };
		}
	} catch {
		// Any layout surprise just means this fallback does not apply.
	}
	return undefined;
}

/**
 * Last-resort checkout scan over the deployment convention
 * `<drive>:\.dsh\deepseek-harness` (the launcher's documented default). Pure
 * stat/read probes across drive letters C..Z — bounded and side-effect free.
 */
async function scanConventionCheckout() {
	for (let code = 67; code <= 90; code += 1) {
		const dir = join(String.fromCharCode(code) + ":\\", ".dsh", "deepseek-harness");
		if (!(await pathExists(dir))) continue;
		const manifest = await manifestAt(join(dir, "apps", "cli"));
		if (manifest !== undefined && manifest.name === APP_PACKAGE) return { dir, manifest };
	}
	return undefined;
}

let installInfoCache;

/**
 * Discover the running dsh installation once per process:
 *   1. argv[1] / cwd walk-up (source run via tsx AND packaged bin both land here),
 *   2. pnpm-global store next to the executable,
 * then refine `root`: DSH_BETTER_REPO_ROOT override first, convention scan second.
 * The root names where a console window should open for rebuilds, independent
 * of how the running binary itself was installed.
 */
async function discoverInstall() {
	if (installInfoCache !== undefined) return installInfoCache;
	installInfoCache = (async () => {
		const fromEntry = process.argv[1] !== undefined && process.argv[1] !== ""
			? await walkUpToAppPackage(dirname(resolve(process.argv[1])))
			: undefined;
		let found = fromEntry;
		let foundVia = "entry";
		if (found === undefined) {
			found = await walkUpToAppPackage(resolve(process.cwd()));
			foundVia = "cwd";
		}
		if (found === undefined) {
			found = await pnpmGlobalInstall();
			foundVia = "pnpm-global";
		}
		let info = found !== undefined
			? await classifyAppPackage(found, foundVia)
			: { version: undefined, installKind: "unknown", root: null, via: "none" };

		if (info.root === null) {
			const override = process.env.DSH_BETTER_REPO_ROOT;
			if (typeof override === "string" && override.trim() !== "" && await isValidSourceTree(override.trim())) {
				info = { ...info, root: resolve(override.trim()), via: info.via === "none" ? "env" : `${info.via}+env` };
			}
		}
		if (info.root === null) {
			const scanned = await scanConventionCheckout();
			if (scanned !== undefined) {
				info = {
					...info,
					root: scanned.dir,
					via: info.via === "none" ? "scan" : `${info.via}+scan`,
					...(info.version === undefined && typeof scanned.manifest.version === "string"
						? { version: scanned.manifest.version }
						: {}),
				};
			}
		}
		return info;
	})();
	return installInfoCache;
}

// ── version comparison + release fetch (update checker) ──────────────────────

/**
 * Compare two version strings (semver-ish, tolerant of missing parts).
 * Returns <0 when a is older, 0 when equal, >0 when a is newer. Prerelease
 * identifiers compare per semver: numeric < alphanumeric, fewer identifiers
 * bind tighter, and any release outranks its own prereleases.
 */
function compareVersions(a, b) {
	const parse = (value) => {
		const text = stripLeadingV(String(value ?? "")).trim();
		const dash = text.indexOf("-");
		const corePart = dash === -1 ? text : text.slice(0, dash);
		const core = corePart.split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : 0));
		while (core.length < 3) core.push(0);
		const pre = dash === -1 || dash + 1 >= text.length ? [] : text.slice(dash + 1).split(".");
		return { core, pre };
	};
	const left = parse(a);
	const right = parse(b);
	for (let i = 0; i < 3; i += 1) {
		if (left.core[i] !== right.core[i]) return left.core[i] < right.core[i] ? -1 : 1;
	}
	if (left.pre.length === 0 && right.pre.length === 0) return 0;
	if (left.pre.length === 0) return 1;
	if (right.pre.length === 0) return -1;
	const shared = Math.min(left.pre.length, right.pre.length);
	for (let i = 0; i < shared; i += 1) {
		const x = left.pre[i];
		const y = right.pre[i];
		const xNum = /^\d+$/.test(x);
		const yNum = /^\d+$/.test(y);
		if (xNum && yNum) {
			const delta = Number(x) - Number(y);
			if (delta !== 0) return delta < 0 ? -1 : 1;
		} else if (xNum !== yNum) {
			return xNum ? -1 : 1;
		} else if (x !== y) {
			return x < y ? -1 : 1;
		}
	}
	return left.pre.length === right.pre.length ? 0 : (left.pre.length < right.pre.length ? -1 : 1);
}

/** Release-cache TTL: gentle on GitHub's unauthenticated rate limit. */
const RELEASE_CACHE_TTL_MS = 5 * 60 * 1000;
/**
 * A past SUCCESS is served (flagged stale) for this long when every upstream
 * source currently fails — the panel keeps working through api.github.com
 * hiccups instead of degrading to an error.
 */
const RELEASE_STALE_TTL_MS = 24 * 60 * 60 * 1000;
const RELEASE_FETCH_TIMEOUT_MS = 9000;
let releaseCache; // { at, value }

/** Shape one GitHub release API object into the wire facts, or undefined. */
function normalizeRelease(data) {
	if (data === null || typeof data !== "object" || typeof data.tag_name !== "string") return undefined;
	return {
		version: normalizeReleaseTag(data.tag_name),
		name: typeof data.name === "string" && data.name !== "" ? data.name : undefined,
		url: typeof data.html_url === "string" && data.html_url !== "" ? data.html_url : RELEASES_PAGE,
		publishedAt: typeof data.published_at === "string" ? data.published_at : undefined,
		prerelease: data.prerelease === true,
	};
}

function decodeXmlEntities(text) {
	const map = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" };
	return String(text).replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (match) => map[match] ?? match);
}

/**
 * Minimal releases.atom entry parse — a third, host-independent source that
 * does not touch api.github.com. The first version-like tag wins (the feed is
 * newest-first; drafts never appear in public feeds).
 */
function parseAtomFeed(xmlText) {
	if (typeof xmlText !== "string") return undefined;
	for (const entry of xmlText.match(/<entry>[\s\S]*?<\/entry>/g) ?? []) {
		const idMatch = entry.match(/<id>([^<]+)<\/id>/);
		const tag = idMatch !== undefined ? decodeXmlEntities(idMatch[1]).split("/").pop() : undefined;
		if (typeof tag !== "string" || tag === "") continue;
		const version = normalizeReleaseTag(tag);
		if (!/^\d/.test(version)) continue;
		const linkMatch = entry.match(/<link[^>]*href="([^"]+)"/);
		const titleMatch = entry.match(/<title>([^<]*)<\/title>/);
		const updatedMatch = entry.match(/<updated>([^<]+)<\/updated>/);
		return {
			version,
			name: titleMatch !== undefined ? decodeXmlEntities(titleMatch[1]) : undefined,
			url: linkMatch !== undefined ? decodeXmlEntities(linkMatch[1]) : RELEASES_PAGE,
			publishedAt: updatedMatch !== undefined ? updatedMatch[1] : undefined,
			prerelease: /-[0-9A-Za-z]/.test(version),
		};
	}
	return undefined;
}

/** One GET against GitHub; returns `{data}`/`{text}` on success or `{error, status}`. */
async function getGithubBody(ctx, url, asText) {
	if (typeof hooks.fetch !== "function") return { error: "fetch-unavailable" };
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(new Error("timeout")), RELEASE_FETCH_TIMEOUT_MS);
	try {
		const response = await hooks.fetch(url, {
			signal: controller.signal,
			headers: {
				"accept": asText === true ? "application/atom+xml" : "application/vnd.github+json",
				"user-agent": "dsh-better (local DeepSeek Harness plugin)",
			},
		});
		if (!response.ok) {
			ctx?.logger?.warn?.(`dsh-better: release lookup ${url} failed with HTTP ${response.status}`);
			return { error: `http-${response.status}`, status: response.status };
		}
		return asText === true ? { text: await response.text() } : { data: await response.json() };
	} catch (error) {
		return { error: String(error?.message ?? error).slice(0, 120) };
	} finally {
		clearTimeout(timer);
	}
}

/** Retry one GET a fixed number of attempts with linear backoff between tries. */
async function withRetry(attempts, task) {
	let last;
	for (let attempt = 1; attempt <= attempts; attempt += 1) {
		if (attempt > 1) await new Promise((resolveDelay) => setTimeout(resolveDelay, 700 * (attempt - 1)));
		const outcome = await task();
		if (outcome.data !== undefined || outcome.text !== undefined) return outcome;
		last = outcome;
	}
	return last;
}

/** Take the first non-draft entry from a /releases list outcome. */
function releaseFromList(outcome, failures) {
	if (outcome.data !== undefined) {
		if (!Array.isArray(outcome.data)) {
			failures.push("unexpected-shape");
			return undefined;
		}
		const pick = outcome.data.find((item) => item !== null && typeof item === "object" && item.draft !== true);
		const normalized = pick !== undefined ? normalizeRelease(pick) : undefined;
		if (normalized !== undefined) return normalized;
		failures.push("no-release");
		return undefined;
	}
	failures.push(outcome.error ?? "unexpected-shape");
	return undefined;
}

/** Parse an atom-feed outcome into release facts. */
function releaseFromAtom(outcome, failures) {
	if (outcome.text !== undefined) {
		const parsed = parseAtomFeed(outcome.text);
		if (parsed !== undefined) return parsed;
		failures.push("atom-unparsable");
		return undefined;
	}
	failures.push(outcome.error ?? "unexpected-shape");
	return undefined;
}

/**
 * Fetch the newest release through three independent sources:
 *   1. `/releases/latest` — canonical, but EXCLUDES prereleases/drafts and
 *      therefore 404s while this repository publishes only prereleases;
 *   2. `/releases` list (one retry) — first non-draft entry, newest-first;
 *   3. `github.com/…releases.atom` (one retry) — different HOST entirely, so
 *      an api.github.com outage (e.g. HTTP 504) cannot take both down.
 * A success caches for the fresh TTL; within the stale TTL a past success is
 * still served (flagged `stale`) when all sources fail right now.
 */
async function fetchLatestRelease(ctx) {
	const now = Date.now();
	if (releaseCache !== undefined && now - releaseCache.at < RELEASE_CACHE_TTL_MS) {
		return releaseCache.value;
	}
	const failures = [];
	const direct = await getGithubBody(ctx, RELEASES_LATEST_API, false);
	let value = direct.data !== undefined ? normalizeRelease(direct.data) : undefined;
	if (value === undefined && direct.error !== undefined) failures.push(direct.error);
	if (value === undefined) {
		value = releaseFromList(await withRetry(2, () => getGithubBody(ctx, RELEASES_LIST_API, false)), failures);
	}
	if (value === undefined) {
		value = releaseFromAtom(await withRetry(2, () => getGithubBody(ctx, RELEASES_ATOM, true)), failures);
	}
	if (value === undefined) {
		if (releaseCache !== undefined && now - releaseCache.at < RELEASE_STALE_TTL_MS) {
			return { ...releaseCache.value, stale: true };
		}
		return { error: failures.join(" + ").slice(0, 200) };
	}
	releaseCache = { at: now, value };
	return value;
}

/** One update-check answer combining local facts and upstream release facts. */
async function updateCheck(ctx) {
	const [install, latest] = await Promise.all([discoverInstall(), fetchLatestRelease(ctx)]);
	const currentVersion = install.version;
	const comparable = latest !== undefined && latest.error === undefined && typeof latest.version === "string";
	let status = "unknown";
	if (comparable && typeof currentVersion === "string") {
		status = compareVersions(latest.version, currentVersion) > 0 ? "update-available" : "up-to-date";
	}
	return {
		status: 200,
		body: {
			ok: true,
			status,
			current: {
				version: typeof currentVersion === "string" ? currentVersion : null,
				installKind: install.installKind,
				root: install.root,
				discoveredVia: install.via,
			},
			latest: comparable
				? {
					version: latest.version,
					name: latest.name,
					url: latest.url,
					publishedAt: latest.publishedAt,
					prerelease: latest.prerelease === true,
					stale: latest.stale === true,
				}
				: null,
			latestError: latest?.error,
			releasesPage: RELEASES_PAGE,
			checkedAt: new Date().toISOString(),
		},
	};
}

/**
 * Spawn detached, distinguishing "binary missing" (resolves null) from a real
 * launch. Spawn failures surface as an ASYNC 'error' event — never as a
 * synchronous throw — so the caller's try/catch never sees them; without this
 * race a bare Linux box would die on the first absent terminal emulator.
 * After settling, a late 'error' gets a no-op listener (an unref'd, detached
 * child failing late must never become an uncaughtException).
 */
function spawnDetachedOrNull(program, args) {
	return new Promise((settle) => {
		const child = spawn(program, args, { detached: true, stdio: "ignore" });
		let settled = false;
		const finish = (value) => {
			if (settled) return;
			settled = true;
			clearTimeout(guard);
			child.removeAllListeners("error");
			child.on("error", () => {});
			child.unref();
			settle(value);
		};
		const guard = setTimeout(() => finish(child), 250);
		child.once("error", () => finish(null));
	});
}

// ── terminal spawn (update checker companion) ────────────────────────────────

/**
 * Open a REAL, user-visible console window at `dir`.
 *
 * Windows pitfall this works around: spawning cmd.exe directly with
 * `detached: true` sets DETACHED_PROCESS, which starts the console app with NO
 * console at all — an invisible process, exactly what a hidden backend must
 * never do. Routing through `cmd /c start` makes ShellExecute allocate a brand
 * new console window for the inner cmd.exe regardless of whether this process
 * has one. The intermediate cmd exits instantly; the visible window is fully
 * independent of (and untracked by) the harness.
 */
async function defaultSpawnTerminal(dir) {
	if (process.platform === "win32") {
		const comspec = typeof process.env.ComSpec === "string" && process.env.ComSpec !== ""
			? process.env.ComSpec
			: "cmd.exe";
		const child = spawn(comspec, ["/d", "/s", "/c", "start", "cmd.exe", "/d"], {
			cwd: dir,
			detached: true,
			stdio: "ignore",
		});
		child.unref();
		return {};
	}
	if (process.platform === "darwin") {
		await spawnDetachedOrNull("open", ["-a", "Terminal", dir]);
		return {};
	}
	for (const program of ["x-terminal-emulator", "gnome-terminal", "konsole", "xfce4-terminal"]) {
		const args = program === "konsole"
			? ["--workdir", dir]
			: ["--working-directory=" + dir];
		const opened = await spawnDetachedOrNull(program, args);
		if (opened !== null) return { pid: opened.pid ?? null };
	}
	throw new Error("unsupported-platform");
}

/** Handle one open-terminal request against the discovered source root. */
async function openTerminal(ctx) {
	const install = await discoverInstall();
	const dir = install.root;
	if (dir === null || dir === undefined) return { status: 409, body: { ok: false, error: "root-not-found" } };
	if (!(await pathExists(dir))) return { status: 400, body: { ok: false, error: "dir-missing", message: dir } };
	const outcome = await hooks.spawnTerminal(dir);
	ctx.logger?.info?.(`dsh-better: opened a console window at ${dir}`);
	return { status: 200, body: { ok: true, opened: dir, ...(outcome ?? {}) } };
}

// ══ model routing subsystem (ported from the dsh-model-router design) ═══════
//
// Scope: keyword rule routing + allowlist-gated model_route tool. The image
// generation channels, the Kimi K3 prompt policy, and V1 migration were left
// out deliberately.

// ── runtime module resolution against the RUNNING application ───────────────

const appModuleCache = new Map();
let appAnchorRequire;

function anchorRequireFor() {
	if (appAnchorRequire === undefined) {
		const candidates = [process.argv[1], process.cwd()].filter((value) => typeof value === "string" && value.length > 0);
		for (const candidate of candidates) {
			try { appAnchorRequire = createRequire(resolve(candidate)); break; } catch { /* try the next anchor */ }
		}
		if (appAnchorRequire === undefined) appAnchorRequire = createRequire(import.meta.url);
	}
	return appAnchorRequire;
}

let cwdAnchorRequire;

function cwdRequireFor() {
	if (cwdAnchorRequire === undefined) {
		try { cwdAnchorRequire = createRequire(resolve(process.cwd(), "package.json")); } catch {
			cwdAnchorRequire = anchorRequireFor();
		}
	}
	return cwdAnchorRequire;
}

/**
 * Walk up from startDir looking for node_modules/<spec>/package.json and
 * derive a loadable entry file from it — a pure-filesystem last resort used
 * only when every require context refused to resolve the spec.
 */
async function probeWalkUp(startDir, spec) {
	let dir = resolve(startDir);
	for (let hop = 0; hop < 16; hop += 1) {
		const pkgJson = join(dir, "node_modules", ...(spec.split("/")), "package.json");
		let manifest;
		try {
			manifest = JSON.parse(await readFile(pkgJson, "utf8"));
		} catch {
			const parent = dirname(dir);
			if (parent === dir) return undefined;
			dir = parent;
			continue;
		}
		const pkgRoot = dirname(pkgJson);
		const explicitMain = typeof manifest.main === "string" && manifest.main.trim() !== "" ? manifest.main : undefined;
		for (const candidate of [
			explicitMain === undefined ? undefined : join(pkgRoot, explicitMain),
			join(pkgRoot, "lib", "index.cjs"),
			join(pkgRoot, "lib", "index.js"),
			join(pkgRoot, "dist", "index.cjs"),
			join(pkgRoot, "dist", "index.js"),
			pkgJson,
		]) {
			if (candidate === undefined) continue;
			try {
				await stat(candidate);
				return candidate;
			} catch { /* try the next convention */ }
		}
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
	return undefined;
}

/**
 * Resolve + import one module through the running app's dependency graph.
 * Deliberately avoids require.resolve(spec, { paths }): plain single-argument
 * resolves are proven to work in every environment this plugin runs in,
 * while the options object has been rejected by the live backend's resolver.
 */
async function importAppModule(spec, bridgeFiles) {
	if (appModuleCache.has(spec)) return appModuleCache.get(spec);
	const requires = [];
	const seen = new Set();
	const pushReq = (factory) => {
		try {
			const req = factory();
			if (typeof req?.resolve === "function" && !seen.has(req)) {
				seen.add(req);
				requires.push(req);
			}
		} catch { /* anchor unavailable */ }
	};
	pushReq(anchorRequireFor);
	pushReq(cwdRequireFor);
	for (const bridgeFile of bridgeFiles ?? []) pushReq(() => createRequire(bridgeFile));

	const failures = [];
	let resolvedPath;
	for (const req of requires) {
		try {
			resolvedPath = req.resolve(spec);
			break;
		} catch (error) {
			failures.push(String(error?.message ?? error).split("\n")[0]);
		}
	}
	if (resolvedPath === undefined && (bridgeFiles ?? []).length > 0) {
		for (const bridgeFile of bridgeFiles ?? []) {
			resolvedPath = await probeWalkUp(dirname(bridgeFile), spec);
			if (resolvedPath !== undefined) break;
		}
	}
	if (resolvedPath === undefined) throw new Error(`${spec}: ${failures.join(" | ").slice(0, 400) || "no usable anchor"}`);
	const mod = await import(pathToFileURL(resolvedPath).href);
	appModuleCache.set(spec, mod);
	return mod;
}

// ── config schema + validation ───────────────────────────────────────────────

class ModelRouteError extends Error {
	constructor(code, message) {
		super(message);
		this.name = "ModelRouteError";
		this.code = code;
	}
}

/**
 * Lenient schemastery schema: nested fields carry defaults but stay optional,
 * so a partially written section still resolves; strict validation happens in
 * resolveRouterConfig on every read and save.
 */
function buildRouterSchema(z) {
	const targetSchema = z.object({
		provider: z.string(),
		model: z.string(),
		reasoningEffort: z.string(),
	});
	const ruleSchema = z.object({
		id: z.string(),
		enabled: z.boolean().default(true),
		keywords: z.array(z.string()).default([]),
		target: targetSchema,
	});
	return z.object({
		enabled: z.boolean().default(true),
		matchCase: z.boolean().default(false),
		rules: z.array(ruleSchema).default([]),
		agentSwitch: z.object({
			enabled: z.boolean().default(false),
			allow: z.array(targetSchema).default([]),
		}),
	});
}

/** One exact route target with trimmed fields; throws a plain Error on garbage. */
function normalizeTarget(raw, pathLabel) {
	const provider = String(raw?.provider ?? "").trim();
	const model = String(raw?.model ?? "").trim();
	if (provider.length === 0) throw new ModelRouteError("CONFIG", `${pathLabel}.provider 不能为空`);
	if (model.length === 0) throw new ModelRouteError("CONFIG", `${pathLabel}.model 不能为空`);
	const effort = typeof raw?.reasoningEffort === "string" ? raw.reasoningEffort.trim() : "";
	return effort.length > 0 ? { provider, model, reasoningEffort: effort } : { provider, model };
}

/** Validate + normalize one whole config object into engine-ready shape. */
function resolveRouterConfig(config = {}) {
	const ids = new Set();
	const rules = (Array.isArray(config.rules) ? config.rules : []).map((rule, index) => {
		const pathLabel = `rules[${index}]`;
		const id = String(rule?.id ?? "").trim();
		if (id.length === 0) throw new ModelRouteError("CONFIG", `${pathLabel}.id 不能为空`);
		if (ids.has(id)) throw new ModelRouteError("CONFIG", `规则 id 重复："${id}"`);
		ids.add(id);
		const keywords = (Array.isArray(rule?.keywords) ? rule.keywords : [])
			.map((keyword) => String(keyword).trim())
			.filter((keyword) => keyword.length > 0);
		if (keywords.length === 0) throw new ModelRouteError("CONFIG", `${pathLabel}.keywords 不能为空（至少一个关键词）`);
		return { id, enabled: rule?.enabled !== false, keywords, target: normalizeTarget(rule?.target, `${pathLabel}.target`) };
	});
	const allow = (Array.isArray(config.agentSwitch?.allow) ? config.agentSwitch.allow : [])
		.map((entry, index) => normalizeTarget(entry, `agentSwitch.allow[${index}]`));
	return {
		enabled: config?.enabled !== false,
		matchCase: config?.matchCase === true,
		rules,
		agentSwitch: { enabled: config?.agentSwitch?.enabled === true, allow },
	};
}

// ── rule engine (pure parts ported from dsh-model-router router.ts) ──────────

/**
 * First-match-wins keyword scan over enabled rules. Disabled rules are
 * skipped; there is no fallback — a miss returns undefined and callers must
 * not modify the session.
 */
function matchRule(rules, text, caseSensitive) {
	if (typeof text !== "string" || text.length === 0) return undefined;
	const haystack = caseSensitive ? text : text.toLowerCase();
	for (const rule of rules) {
		if (!rule.enabled) continue;
		for (const keyword of rule.keywords) {
			const needle = caseSensitive ? keyword : keyword.toLowerCase();
			if (haystack.includes(needle)) return rule;
		}
	}
	return undefined;
}

/** Whether two targets name the same route (no-op guard for header writes). */
function selectionEquals(current, target) {
	return current.provider === target.provider
		&& current.model === target.model
		&& (current.reasoningEffort ?? "") === (target.reasoningEffort ?? "");
}

/**
 * Write a validated selection to the durable session request/header channel
 * with reason "change"; skipped when the session already runs it. Returns
 * whether anything was written.
 */
function applySelection(agent, target, canonicalHeader) {
	const currentHeader = agent.session.requestHeader()?.config;
	if (currentHeader !== undefined && selectionEquals({
		provider: currentHeader.provider,
		model: currentHeader.model,
		...(currentHeader.reasoningEffort === undefined ? {} : { reasoningEffort: String(currentHeader.reasoningEffort) }),
	}, target)) return false;
	agent.session.append("request/header", {
		header: canonicalHeader({ config: { provider: target.provider, model: target.model, ...(target.reasoningEffort === undefined ? {} : { reasoningEffort: target.reasoningEffort }) } }),
		reason: "change",
	});
	return true;
}

/**
 * Exact target validation against the live DSH registry:
 * provider must be active, model must resolve exactly via resolveModelInfo,
 * and an explicit reasoningEffort must pass resolveCallConfig. Failures throw
 * stable-coded ModelRouteErrors and NEVER touch the session.
 */
async function resolveTarget(llm, target, signal) {
	const activeIds = new Set(llm.listProviders().map((provider) => provider.id));
	if (!activeIds.has(target.provider)) {
		throw new ModelRouteError("ROUTE_PROVIDER_INACTIVE", `提供方 "${target.provider}" 未在 DSH 模型页激活（或不存在）`);
	}
	let info;
	try {
		info = await llm.resolveModelInfo(target.provider, target.model, signal);
	} catch (error) {
		throw new ModelRouteError("ROUTE_MODEL_UNRESOLVED", `模型 "${target.model}"（${target.provider}）无法解析：${String(error?.message ?? error).slice(0, 160)}`);
	}
	if (typeof target.reasoningEffort === "string" && target.reasoningEffort.length > 0) {
		try {
			await llm.resolveCallConfig({ provider: target.provider, model: target.model, reasoningEffort: target.reasoningEffort }, signal);
		} catch (error) {
			throw new ModelRouteError("ROUTE_REASONING_INVALID", `推理强度 "${target.reasoningEffort}" 不被 ${target.provider}/${target.model} 支持：${String(error?.message ?? error).slice(0, 160)}`);
		}
	}
	return {
		selection: { ...target },
		reasoningEfforts: (info?.reasoning?.efforts ?? []).map((entry) => ({
			id: entry.id,
			name: entry.name,
			...(entry.description === undefined ? {} : { description: entry.description }),
		})),
	};
}

// ── model_route tool factory (ported from tools.ts, allowlist-gated) ─────────

const MODEL_ROUTE_OUTPUT_SCHEMA = {
	type: "object",
	required: ["applied", "note"],
	properties: {
		applied: {
			type: "object",
			required: ["provider", "model"],
			properties: {
				provider: { type: "string" },
				model: { type: "string" },
				reasoningEffort: { type: "string" },
			},
		},
		note: { type: "string" },
	},
};

/**
 * Build the allowlist-gated model_route tool. The parameter surface exposes
 * nothing but free strings; every execution matches an exact allowlist entry,
 * then passes live DSH validation, then writes the session header.
 */
function createModelRouteTool(deps) {
	return {
		name: "model_route",
		description: "Manually switch this session to one of the allowed model routes. provider/model (and reasoningEffort when the allowed entry pins one) must match an allowed entry exactly; the switch takes effect on the NEXT assistant message.",
		parameters: {
			type: "object",
			required: ["provider", "model"],
			properties: {
				provider: { type: "string", description: "Exact provider id from the allowed routes." },
				model: { type: "string", description: "Exact model id from the allowed routes." },
				reasoningEffort: { type: "string", description: "Optional reasoning effort; must match the allowed entry when it pins one." },
			},
		},
		output: {
			schema: MODEL_ROUTE_OUTPUT_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: value?.applied === undefined || value?.applied === null
					? "会话模型路由已请求。"
					: `会话模型路由已应用：${value.applied.provider}/${value.applied.model}${value.applied.reasoningEffort === undefined ? "" : ` (${value.applied.reasoningEffort})`}。下一条助手消息将使用该路由。`,
			}],
			presentationMeta: (_args, value) => value,
		},
		isConcurrencySafe: () => false,
		execute: async (args, exec) => {
			const agent = exec?.agent;
			if (agent === undefined) throw new ModelRouteError("NO_AGENT", "model_route 只能在智能体会话内运行");
			const input = args ?? {};
			const provider = String(input.provider ?? "").trim();
			const model = String(input.model ?? "").trim();
			const effort = typeof input.reasoningEffort === "string" ? input.reasoningEffort.trim() : "";
			if (provider.length === 0 || model.length === 0) {
				throw new ModelRouteError("INVALID_TARGET", "model_route 需要非空的 provider 与 model");
			}
			const allowlist = deps.allowlist();
			const allowed = allowlist.find((entry) =>
				entry.provider === provider && entry.model === model && (entry.reasoningEffort ?? "") === effort);
			if (allowed === undefined) {
				const entries = allowlist.map((entry) => `${entry.provider}/${entry.model}${entry.reasoningEffort === undefined ? "" : `(${entry.reasoningEffort})`}`).join(", ") || "(空)";
				throw new ModelRouteError("ROUTE_NOT_ALLOWED", `目标不在白名单内；允许的路由：${entries}`);
			}
			const resolved = await deps.resolveTarget(allowed, exec.signal);
			deps.apply(agent, resolved.selection);
			return {
				applied: { ...resolved.selection },
				note: "切换已生效；下一条 assistant 消息将使用新路由。",
			};
		},
	};
}

// ── provider directory + catalog cache ───────────────────────────────────────

/** Active providers merged with declared configurable entries (dormant kept). */
function providerDirectory(llm) {
	const active = new Map(llm.listProviders().map((provider) => [provider.id, provider.name]));
	const rows = [];
	const seen = new Set();
	for (const entry of llm.listConfigurableProviders()) {
		const provider = entry.provider;
		seen.add(provider);
		rows.push({
			provider,
			displayName: entry.displayName !== undefined && entry.displayName.length > 0 ? entry.displayName : (active.get(provider) ?? provider),
			active: active.has(provider),
		});
	}
	for (const [provider, displayName] of active) {
		if (seen.has(provider)) continue;
		rows.push({ provider, displayName, active: true });
	}
	return rows;
}

/** Short-TTL catalog cache invalidated by llm/adapters-updated. */
function createCatalogCache(llm) {
	let epoch = 0;
	let cache;
	return {
		invalidate() { epoch += 1; },
		async get() {
			const at = Date.now();
			if (cache !== undefined && cache.epoch === epoch && at - cache.fetchedAt < 30_000) return cache;
			const providers = providerDirectory(llm);
			const modelsByProvider = {};
			const catalogError = {};
			await Promise.allSettled(providers.filter((row) => row.active).map(async (row) => {
				try {
					const models = await llm.listModels(row.provider);
					modelsByProvider[row.provider] = models.map((model) => ({ id: model.id, ...(model.name === undefined ? {} : { name: model.name }) }));
				} catch (error) {
					catalogError[row.provider] = String(error?.message ?? error).slice(0, 200);
				}
			}));
			cache = { epoch, fetchedAt: at, providers, modelsByProvider, catalogError };
			return cache;
		},
	};
}

// ── subsystem setup ──────────────────────────────────────────────────────────

async function loadRoutingModules() {
	const loaded = { z: undefined, canonicalHeader: undefined, installModelSelection: undefined };
	const missing = [];
	try {
		loaded.canonicalHeader = (await importAppModule("@deepseek-ai/dsh-session")).canonicalHeader;
	} catch (error) {
		missing.push(`@deepseek-ai/dsh-session（${String(error?.message ?? error).slice(0, 120)}）`);
	}
	try {
		loaded.installModelSelection = (await importAppModule("@deepseek-ai/dsh-agent")).installModelSelection;
	} catch (error) {
		missing.push(`@deepseek-ai/dsh-agent（${String(error?.message ?? error).slice(0, 120)}）`);
	}
	try {
		// The vendored fork is not a direct apps/cli dependency; anchor extra
		// require contexts at the resolvable dsh-settings ENTRY FILE — Node then
		// walks up through that package's own node_modules, exactly like its
		// own imports do. All steps are best-effort: a pre-seeded test cache
		// short-circuits before any of this runs.
		let bridgeFiles;
		try {
			bridgeFiles = [anchorRequireFor().resolve("@deepseek-ai/dsh-settings")];
		} catch {
			try { bridgeFiles = [cwdRequireFor().resolve("@deepseek-ai/dsh-settings")]; } catch { bridgeFiles = []; }
		}
		const mod = await importAppModule("@deepseek-ai/schemastery", bridgeFiles);
		loaded.z = mod.default ?? mod;
	} catch (error) {
		missing.push(`@deepseek-ai/schemastery（${String(error?.message ?? error).slice(0, 120)}）`);
	}
	return { loaded, missing };
}

function isSettingsConflict(error) {
	return error?.name === "SettingsConflictError" || error?.constructor?.name === "SettingsConflictError";
}

/**
 * Wire the routing subsystem onto the plugin context. Returns a handle whose
 * `ready` flag says whether the engine could start (false → snapshot routes
 * explain why); `dispose()` tears down everything this setup created.
 */
async function createModelRouting(ctx) {
	const handle = {
		ready: false,
		reason: "",
		scope: undefined,
		canonicalHeader: undefined,
		installModelSelection: undefined,
		catalogCache: undefined,
		validatedTargets: new Map(),
		validationEpoch: 0,
		lastGoodConfig: undefined,
		disposeBag: { rule: undefined, tool: undefined },
		watchers: [],
		subagentDisposers: new Set(),
	};

	const warn = (format, ...args) => ctx.logger?.warn?.(`dsh-better: ${format}`, ...args);

	// 1. Runtime modules. ReasoningEffortId upstream is an identity brand cast,
	//    so plain strings are passed straight through instead of importing it.
	const { loaded, missing } = await loadRoutingModules();
	handle.canonicalHeader = loaded.canonicalHeader;
	handle.installModelSelection = loaded.installModelSelection;
	if (loaded.z === undefined || loaded.canonicalHeader === undefined) {
		handle.reason = `宿主模块解析失败：${missing.join("; ")}`;
		warn("模型路由不可用 —— %s", handle.reason);
		return handle;
	}

	// 2. Settings namespace (an effect on the plugin fiber).
	try {
		handle.scope = ctx.settings.register(ROUTER_SETTINGS_NS, buildRouterSchema(loaded.z), {
			applies: "live",
			validate: (value) => { resolveRouterConfig(value ?? {}); },
		});
	} catch (error) {
		handle.reason = `settings 命名空间 "${ROUTER_SETTINGS_NS}" 注册失败：${String(error?.message ?? error).slice(0, 200)}`;
		warn("%s", handle.reason);
		return handle;
	}
	handle.ready = true;

	/** Latest validated config; keeps the last good copy across bad reads. */
	function currentConfig() {
		try {
			const resolved = resolveRouterConfig(handle.scope.get() ?? {});
			handle.lastGoodConfig = resolved;
			return resolved;
		} catch (error) {
			warn("配置读取失败，沿用上一份有效配置：%s", String(error?.message ?? error));
			return handle.lastGoodConfig;
		}
	}

	/** Refresh the validated-target cache; only the newest run commits. */
	async function validateRuleTargets(cfg) {
		const epoch = ++handle.validationEpoch;
		const llm = ctx.get("llm");
		const next = new Map();
		if (llm !== undefined) {
			for (const rule of cfg.rules) {
				if (!rule.enabled) continue;
				try {
					const resolved = await resolveTarget(llm, rule.target);
					next.set(rule.id, resolved.selection);
				} catch (error) {
					warn("规则 \"%s\" 暂不生效（%s）", rule.id, error instanceof ModelRouteError ? error.code : String(error?.message ?? error));
				}
			}
		}
		if (epoch !== handle.validationEpoch) return;
		handle.validatedTargets.clear();
		for (const [id, target] of next) handle.validatedTargets.set(id, target);
	}

	/**
	 * Subagent children bypass api-proxy's selection assembly, so their first
	 * request would ignore the freshly written session header. Installing the
	 * official selection lazily makes them behave like mainline sessions.
	 */
	function installSubagentSelection(agent) {
		if (handle.installModelSelection === undefined) return;
		try {
			if (agent.session.header.origin !== "subagent") return;
			if (handle.subagentDisposers.size > 4096) return; // paranoia bound; agents are finite
			let seen;
			const selection = {
				get current() {
					seen = agent.session.requestHeader()?.config;
					if (seen === undefined) return undefined;
					return {
						provider: seen.provider,
						model: seen.model,
						...(seen.reasoningEffort === undefined ? {} : { reasoningEffort: String(seen.reasoningEffort) }),
					};
				},
				assembled: undefined,
			};
			const dispose = handle.installModelSelection(agent.ctx, selection);
			handle.subagentDisposers.add(dispose);
		} catch { /* best-effort repair only */ }
	}

	function reconcile() {
		handle.disposeBag.rule?.();
		handle.disposeBag.rule = undefined;
		handle.disposeBag.tool?.();
		handle.disposeBag.tool = undefined;
		const cfg = currentConfig();
		if (cfg === undefined) return;

		if (cfg.enabled && cfg.rules.length > 0) {
			void validateRuleTargets(cfg);
			handle.disposeBag.rule = ctx.on("agent/inbox/inserted", ({ agent, message }) => {
				try {
					if (message?.source?.kind !== "user") return;
					const text = (Array.isArray(message.content) ? message.content : [])
						.filter((block) => block?.type === "text")
						.map((block) => block.text)
						.join(" ")
						.trim();
					if (text.length === 0) return;
					const hit = matchRule(cfg.rules, text, cfg.matchCase);
					if (hit === undefined) return; // no-match: never touch the session
					const target = handle.validatedTargets.get(hit.id);
					if (target === undefined) {
						warn("规则 \"%s\" 未通过校验，会话 %s 保持不变", hit.id, String(agent.id));
						return;
					}
					installSubagentSelection(agent);
					applySelection(agent, target, handle.canonicalHeader);
					ctx.logger?.info?.(
						"dsh-better: 关键词规则 \"%s\" 将会话 %s 路由到 %s/%s%s",
						hit.id, String(agent.id), target.provider, target.model,
						target.reasoningEffort === undefined ? "" : ` (${target.reasoningEffort})`,
					);
				} catch (error) {
					warn("路由监听器内部错误（已忽略）：%s", String(error?.message ?? error));
				}
			});
		}

		if (cfg.enabled) {
			if (cfg.agentSwitch.enabled && cfg.agentSwitch.allow.length > 0) {
				handle.disposeBag.tool = ctx.get("tools")?.register(createModelRouteTool({
					allowlist: () => currentConfig()?.agentSwitch.allow ?? [],
					resolveTarget: (target, signal) => resolveTarget(ctx.get("llm"), target, signal),
					apply: (agent, selection) => { applySelection(agent, selection, handle.canonicalHeader); },
				}));
			} else if (cfg.agentSwitch.enabled) {
				warn("model_route 已开启但白名单为空，工具不会注册。");
			}
		}
	}

	function safeReconcile() {
		try { reconcile(); } catch (error) {
			warn("reconcile 失败（已忽略）：%s", String(error?.message ?? error));
		}
	}

	handle.catalogCache = createCatalogCache(ctx.get("llm"));

	// 3. Live re-wiring on settings changes and model topology changes.
	handle.watchers.push(
		handle.scope.watch(() => { safeReconcile(); }),
		ctx.on("llm/adapters-updated", () => { handle.catalogCache.invalidate(); safeReconcile(); }),
	);

	safeReconcile();

	handle.currentConfig = currentConfig;

	/** Re-run reconcile + rule-target validation, awaiting the validation pass. */
	handle.reconcileAndValidate = async () => {
		safeReconcile();
		const cfg = currentConfig();
		if (cfg !== undefined && cfg.enabled && cfg.rules.length > 0) {
			try { await validateRuleTargets(cfg); } catch { /* already logged inside */ }
		}
	};

	/** Tear down every listener/tool/selection this setup installed. */
	handle.dispose = () => {
		handle.watchers.splice(0).forEach((dispose) => { try { dispose(); } catch { /* already gone */ } });
		handle.disposeBag.rule?.();
		handle.disposeBag.rule = undefined;
		handle.disposeBag.tool?.();
		handle.disposeBag.tool = undefined;
		for (const dispose of [...handle.subagentDisposers]) {
			try { dispose(); } catch { /* agent already gone */ }
		}
		handle.subagentDisposers.clear();
	};

	return handle;
}

/** Snapshot payload shared by GET and POST-save responses. */
async function routerSnapshotPayload(ctx, handle, sessionId) {
	const cat = handle.ready ? await handle.catalogCache.get() : { providers: [], modelsByProvider: {}, catalogError: {} };
	const descriptor = ctx.settings.describe().find((row) => row.ns === ROUTER_SETTINGS_NS);
	const cfg = handle.currentConfig();
	let defaultModel = null;
	try {
		const selection = ctx.get("agentDefaultModel")?.currentSelection();
		if (selection !== undefined && selection !== null && typeof selection.provider === "string") {
			defaultModel = {
				provider: selection.provider,
				model: selection.model,
				...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: String(selection.reasoningEffort) }),
			};
		}
	} catch { /* default model stays unknown */ }
	let effective = null;
	if (typeof sessionId === "string" && sessionId.length > 0) {
		let headerConfig;
		try { headerConfig = ctx.get("agents")?.get?.(sessionId)?.session?.requestHeader?.()?.config; } catch { headerConfig = undefined; }
		effective = headerConfig !== undefined
			? {
				source: "session",
				selection: {
					provider: headerConfig.provider,
					model: headerConfig.model,
					...(headerConfig.reasoningEffort === undefined ? {} : { reasoningEffort: String(headerConfig.reasoningEffort) }),
				},
			}
			: { source: "default", selection: defaultModel };
	}
	return {
		ok: true,
		available: handle.ready === true,
		config: cfg ?? { enabled: true, matchCase: false, rules: [], agentSwitch: { enabled: false, allow: [] } },
		revision: descriptor?.revision ?? 0,
		writable: ctx.settings.writable === true,
		features: { modelRouteRegistered: handle.disposeBag.tool !== undefined },
		subagentRepairAvailable: handle.installModelSelection !== undefined,
		// Rule ids whose target passed live DSH validation and may actually fire.
		validatedRuleIds: [...handle.validatedTargets.keys()],
		providers: cat.providers,
		modelsByProvider: cat.modelsByProvider,
		catalogError: cat.catalogError,
		defaultModel,
		effective,
	};
}

/** Persist one submitted config; returns the HTTP outcome envelope. */
async function saveRouterConfig(ctx, handle, body) {
	if (handle.ready !== true) return { status: 501, body: { ok: false, error: "router-unavailable", message: handle.reason } };
	const expectedRevision = Number(body?.expectedRevision);
	if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
		return { status: 400, body: { ok: false, error: "expected-revision-required" } };
	}
	try {
		resolveRouterConfig(body?.value ?? {});
	} catch (error) {
		return { status: 400, body: { ok: false, error: "invalid-config", message: String(error?.message ?? error).slice(0, 300) } };
	}
	try {
		await ctx.settings.replace(ROUTER_SETTINGS_NS, body?.value ?? {}, expectedRevision);
	} catch (error) {
		if (isSettingsConflict(error)) return { status: 409, body: { ok: false, error: "conflict" } };
		ctx.logger?.warn?.(`dsh-better: 路由配置保存失败：${String(error?.message ?? error)}`);
		return { status: 500, body: { ok: false, error: "save-failed", message: String(error?.message ?? error).slice(0, 200) } };
	}
	// Re-validate rule targets so the snapshot's validatedRuleIds reflects the
	// JUST-saved config (validation is async; the settings watch fires too but
	// might not have settled by the time we answer, and the UI reads it now).
	await handle.reconcileAndValidate?.();
	return { status: 200, body: await routerSnapshotPayload(ctx, handle, undefined) };
}

/** Apply one route to a live session; returns the HTTP outcome envelope. */
async function applyRouterTarget(ctx, handle, body) {
	if (handle.ready !== true) return { status: 501, body: { ok: false, error: "router-unavailable", message: handle.reason } };
	const sessionId = String(body?.sessionId ?? "").trim();
	if (sessionId.length === 0) return { status: 400, body: { ok: false, error: "session-required" } };
	let target;
	try {
		target = normalizeTarget(body?.target, "target");
	} catch (error) {
		return { status: 400, body: { ok: false, error: "invalid-target", message: String(error?.message ?? error).slice(0, 200) } };
	}
	const agent = ctx.get("agents")?.get?.(sessionId);
	if (agent === undefined) return { status: 404, body: { ok: false, error: "session-not-found" } };
	try {
		await resolveTarget(ctx.get("llm"), target, undefined);
	} catch (error) {
		if (error instanceof ModelRouteError) return { status: 400, body: { ok: false, error: error.code, message: error.message } };
		return { status: 500, body: { ok: false, error: "resolve-failed", message: String(error?.message ?? error).slice(0, 200) } };
	}
	const changed = applySelection(agent, target, handle.canonicalHeader);
	return { status: 200, body: { ok: true, applied: target, changed } };
}

/** Reasoning-effort lookup for one provider/model pair. */
async function routerEfforts(ctx, query) {
	const llm = ctx.get("llm");
	if (llm === undefined) return { status: 501, body: { ok: false, error: "llm-unavailable" } };
	const provider = String(query.get("provider") ?? "").trim();
	const model = String(query.get("model") ?? "").trim();
	if (provider.length === 0 || model.length === 0) return { status: 400, body: { ok: false, error: "provider-and-model-required" } };
	try {
		const info = await llm.resolveModelInfo(provider, model, undefined);
		return {
			status: 200,
			body: {
				ok: true,
				efforts: (info?.reasoning?.efforts ?? []).map((entry) => ({
					id: entry.id,
					name: entry.name,
					...(entry.description === undefined ? {} : { description: entry.description }),
				})),
				defaultEffort: info?.reasoning?.defaultEffort,
			},
		};
	} catch (error) {
		return { status: 400, body: { ok: false, error: "resolve-failed", message: String(error?.message ?? error).slice(0, 200) } };
	}
}



// ── HTTP glue ────────────────────────────────────────────────────────────────

/** Wrap one mutating operation with serialization + uniform failure mapping. */
function runMutation(ctx, res, operation) {
	void enqueue(async () => {
		try {
			const outcome = await operation(ctx);
			json(res, outcome.status, outcome.body);
		} catch (error) {
			ctx.logger?.warn?.(`dsh-better: operation failed: ${String(error)}`);
			json(res, 500, { ok: false, error: "internal", message: String(error) });
		}
	});
}

// ── plugin body ──────────────────────────────────────────────────────────────

/**
 * Plugin body: register the five exact routes.
 * @param ctx - plugin context carrying webServer, storageDomain, loader, sessionPersistence, and sessions.
 */
async function apply(ctx) {
	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: LIST_PATH,
		handler: (req, res) => {
			if (rejectForeignCaller(req, res, "GET")) return;
			void enqueue(async () => {
				try {
					const outcome = await listArchived(ctx);
					json(res, outcome.status, outcome.body);
				} catch (error) {
					ctx.logger?.warn?.(`dsh-better: list failed: ${String(error)}`);
					json(res, 500, { ok: false, error: "internal", message: String(error) });
				}
			});
		},
	}), "dsh-better: archived list route");

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: RESTORE_PATH,
		handler: (req, res) => {
			if (rejectForeignCaller(req, res, "POST")) return;
			readJsonBody(req).then(
				(body) => { runMutation(ctx, res, (c) => restoreArchived(c, body.sessionId)); },
				() => { json(res, 400, { ok: false, error: "malformed-json" }); },
			);
		},
	}), "dsh-better: restore route");

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: DELETE_PATH,
		handler: (req, res) => {
			if (rejectForeignCaller(req, res, "POST")) return;
			readJsonBody(req).then(
				(body) => { runMutation(ctx, res, (c) => deleteArchived(c, body.sessionId)); },
				() => { json(res, 400, { ok: false, error: "malformed-json" }); },
			);
		},
	}), "dsh-better: delete route");

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: UPDATE_PATH,
		handler: (req, res) => {
			if (rejectForeignCaller(req, res, "GET")) return;
			void enqueue(async () => {
				try {
					const outcome = await updateCheck(ctx);
					json(res, outcome.status, outcome.body);
				} catch (error) {
					ctx.logger?.warn?.(`dsh-better: update check failed: ${String(error)}`);
					json(res, 500, { ok: false, error: "internal", message: String(error) });
				}
			});
		},
	}), "dsh-better: update-check route");

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: TERMINAL_PATH,
		handler: (req, res) => {
			if (rejectForeignCaller(req, res, "POST")) return;
			readJsonBody(req).then(
				async () => {
					try {
						const outcome = await openTerminal(ctx);
						json(res, outcome.status, outcome.body);
					} catch (error) {
						ctx.logger?.warn?.(`dsh-better: terminal spawn failed: ${String(error)}`);
						json(res, 500, { ok: false, error: "spawn-failed", message: String(error) });
					}
				},
				() => { json(res, 400, { ok: false, error: "malformed-json" }); },
			);
		},
	}), "dsh-better: open-terminal route");

	// ── model routing (v0.3.0): engine + policy routes ────────────────────────
	const router = await createModelRouting(ctx);
	ctx.effect(() => () => { try { router.dispose?.(); } catch { /* teardown is best-effort */ } }, "dsh-better: model routing teardown");

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: ROUTER_SNAPSHOT_PATH,
		handler: (req, res) => {
			if (rejectForeignCaller(req, res, "GET")) return;
			void enqueue(async () => {
				try {
					let sessionId;
					try { sessionId = new URL(req.url, "http://localhost").searchParams.get("sessionId") ?? undefined; } catch { sessionId = undefined; }
					const payload = router.ready === true
						? await routerSnapshotPayload(ctx, router, sessionId)
						: { ok: true, available: false, reason: router.reason };
					json(res, 200, payload);
				} catch (error) {
					ctx.logger?.warn?.(`dsh-better: model-router snapshot failed: ${String(error)}`);
					json(res, 500, { ok: false, error: "internal", message: String(error) });
				}
			});
		},
	}), "dsh-better: model-router snapshot route");

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: ROUTER_SAVE_PATH,
		handler: (req, res) => {
			if (rejectForeignCaller(req, res, "POST")) return;
			readJsonBody(req).then(
				(body) => { runMutation(ctx, res, async () => saveRouterConfig(ctx, router, body)); },
				() => { json(res, 400, { ok: false, error: "malformed-json" }); },
			);
		},
	}), "dsh-better: model-router save route");

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: ROUTER_APPLY_PATH,
		handler: (req, res) => {
			if (rejectForeignCaller(req, res, "POST")) return;
			readJsonBody(req).then(
				(body) => { runMutation(ctx, res, async () => applyRouterTarget(ctx, router, body)); },
				() => { json(res, 400, { ok: false, error: "malformed-json" }); },
			);
		},
	}), "dsh-better: model-router apply route");

	ctx.effect(() => ctx.webServer.register({
		kind: "exact",
		path: ROUTER_EFFORTS_PATH,
		handler: (req, res) => {
			if (rejectForeignCaller(req, res, "GET")) return;
			void enqueue(async () => {
				try {
					let query;
					try { query = new URL(req.url, "http://localhost").searchParams; } catch { query = new URLSearchParams(); }
					const outcome = await routerEfforts(ctx, query);
					json(res, outcome.status, outcome.body);
				} catch (error) {
					ctx.logger?.warn?.(`dsh-better: efforts lookup failed: ${String(error)}`);
					json(res, 500, { ok: false, error: "internal", message: String(error) });
				}
			});
		},
	}), "dsh-better: model-router efforts route");
}

export {
	apply,
	inject,
	name,
	LIST_PATH,
	RESTORE_PATH,
	DELETE_PATH,
	UPDATE_PATH,
	TERMINAL_PATH,
	ROUTER_SNAPSHOT_PATH,
	ROUTER_EFFORTS_PATH,
	ROUTER_SAVE_PATH,
	ROUTER_APPLY_PATH,
	ROUTER_SETTINGS_NS,
	RELEASES_PAGE,
	compareVersions,
	matchRule,
	resolveRouterConfig,
	normalizeTarget,
	selectionEquals,
	resolveTarget,
	createModelRouteTool,
	ModelRouteError,
	hooks as testHooks,
};
