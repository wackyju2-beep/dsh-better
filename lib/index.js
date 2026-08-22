/**
 * dsh-better — host half.
 *
 * Registers three loopback-only endpoints on the web server that the shipped
 * gateway deliberately does not expose, so the browser half can manage
 * archived sessions:
 *
 *   GET  /api/dsh-better/archived — every archived session with its header facts
 *   POST /api/dsh-better/restore  — unarchive one session (back to its workspace slot)
 *   POST /api/dsh-better/delete   — delete one archived session's local log and registry rows
 *
 * The endpoints live under the /api prefix as EXACT routes, so they win over
 * the connection plugin's /api prefix handler; each handler applies its own
 * peer-socket loopback fence. This mirrors the proven community-plugin route
 * posture (dsh-usage-stats).
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

import { unlink } from "node:fs/promises";

/** Stable Cordis plugin name. */
const name = "dsh-better";

/** Services required before this plugin activates. */
const inject = ["webServer", "storageDomain", "loader", "sessionPersistence", "sessions"];

const LIST_PATH = "/api/dsh-better/archived";
const RESTORE_PATH = "/api/dsh-better/restore";
const DELETE_PATH = "/api/dsh-better/delete";

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
 * Plugin body: register the three exact routes.
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
}

export { apply, inject, name, LIST_PATH, RESTORE_PATH, DELETE_PATH };
