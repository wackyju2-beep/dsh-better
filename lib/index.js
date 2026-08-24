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

/** Stable Cordis plugin name. */
const name = "dsh-better";

/** Services required before this plugin activates. */
const inject = ["webServer", "storageDomain", "loader", "sessionPersistence", "sessions"];

const LIST_PATH = "/api/dsh-better/archived";
const RESTORE_PATH = "/api/dsh-better/restore";
const DELETE_PATH = "/api/dsh-better/delete";
const UPDATE_PATH = "/api/dsh-better/update-check";
const TERMINAL_PATH = "/api/dsh-better/open-terminal";

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
	if (isLoopbackAddress(peer) && isLoopbackHostHeader(req)) return false;
	json(res, 403, { ok: false, error: "forbidden" });
	return true;
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
	RELEASES_PAGE,
	compareVersions,
	hooks as testHooks,
};
