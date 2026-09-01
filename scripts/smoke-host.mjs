
// dsh-better host-half integration smoke: fake ctx, exercise list/restore/delete
// plus the update-checker and open-terminal routes.
import { writeFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert";

const mod = await import("../lib/index.js");
assert.equal(typeof mod.apply, "function");
console.log("host exports:", Object.keys(mod).join(","));

// Version comparator table (exported for exactly this).
const cmpCases = [
	["0.1.1-rc.1", "0.1.1-rc.2", -1],
	["0.1.1-rc.2", "0.1.1", -1],
	["0.1.1", "0.1.1", 0],
	["1.0", "1.0.0", 0],
	["v0.2.0", "0.1.9", 1],
	["0.2", "0.1.99", 1],
	["0.1.1-beta.2", "0.1.1-beta.10", -1],
	["0.1.1-alpha", "0.1.1-beta", -1],
	["0.1.1-rc.1", "0.1.1-beta.3", 1],
	["0.1.1-rc.1", "0.1.1-rc", 1],
	["0.1.1-rc.1", "0.1.2", -1],
];
for (const [a, b, expected] of cmpCases) {
	const sign = Math.sign(mod.compareVersions(a, b));
	assert.equal(sign, expected, `compareVersions(${a}, ${b}) => ${sign}, want ${expected}`);
}
console.log("compareVersions table OK:", cmpCases.length, "cases");

const routes = new Map();
const warnings = [];
const emittedEvents = [];
const domainState = { initialized: true, workspaceIds: ["w1"], archivedSessionIds: ["s-archived", "s-gone", "s-orphan", "s-idle", "s-running", "s-live"] };
const records = new Map([["w1", { path: "C:/proj", title: "proj", sessionIds: ["s-archived", "s-other"], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }]]);
let restarts = 0;
// In-place mirror-sync seams: the fake registry mimics the real
// WorkspaceRegistry shape (setState stores the served snapshot; entities Map
// holds one object per record whose `record` property is its served snapshot).
const registryMirror = { state: null };
const fakeEntities = new Map([["w1", { record: records.get("w1") }]]);
const fakeRegistry = {
	// scheduler targets read this list(); the in-place sync reads setState/entities.
	list: () => [{ id: "w1", path: "C:/proj", title: "proj", sessionIds: ["session-ws1-a", "session-ws1-b", "session-cold"] }],
	setState(next) { registryMirror.state = next; },
	entities: fakeEntities,
};

// ── model-routing stub services ──────────────────────────────────────────────
const eventHandlers = new Map();
const appendedHeaders = [];
const agentState = { config: undefined };
const fakeAgent = {
	id: "session-main",
	ctx: {},
	session: {
		header: {},
		requestHeader: () => (agentState.config === undefined ? undefined : { config: agentState.config }),
		append(_type, entry) { appendedHeaders.push(entry); agentState.config = entry.header.config; },
	},
};
const registeredTools = [];
const llmStub = {
	listProviders: () => [{ id: "deepseek-official", name: "DeepSeek" }],
	listConfigurableProviders: () => [
		{ provider: "deepseek-official", displayName: "DeepSeek", settingsNs: "llm-deepseek", settingsPath: [] },
		{ provider: "openrouter", displayName: "OpenRouter", settingsNs: "llm-openrouter", settingsPath: [] },
	],
	listModels: async (provider) => (provider === "deepseek-official" ? [{ id: "deepseek-v4-flash", name: "V4 Flash" }] : []),
	resolveModelInfo: async (_provider, model) => ({
		provider: _provider, id: model, name: model,
		reasoning: { efforts: [{ id: "high", name: "High" }, { id: "low", name: "Low" }], defaultEffort: "high" },
	}),
	resolveCallConfig: async (config) => config,
};

// ── scheduler stub services ──────────────────────────────────────────────────
// followup receipts + a resolveAgent that cold-resumes two session ids.
const followups = [];
const coldAgents = new Map();
const liveAgents = new Map();
function makeFakeAgent(id, cwd) {
	const agent = {
		id,
		followup: (message) => { followups.push({ agent: id, message }); },
		session: { header: { id, cwd, createdAt: Date.parse("2026-01-01T00:00:00Z") } },
	};
	return agent;
}
for (const id of ["session-ws1-a", "session-ws1-b"]) liveAgents.set(id, makeFakeAgent(id, "C:/proj"));
coldAgents.set("session-cold", makeFakeAgent("session-cold", "C:/proj"));
coldAgents.set("session-cold2", makeFakeAgent("session-cold2", "D:/elsewhere"));

// ── archive-delete stub services ─────────────────────────────────────────────
// Attached-session kinds the delete path must distinguish: s-live is attached
// with NO resolvable agent (un-detachable → refused), s-idle is attached with
// a disposable agent fiber, s-running is attached with a RUNNING agent.
const attachedSessions = new Map();
const agentBySession = new Map();
function makeAttached(id, { running = false, withAgent = true } = {}) {
	attachedSessions.set(id, { id });
	if (!withAgent) return;
	agentBySession.set(id, {
		id,
		status: running ? "running" : "idle",
		ctx: { fiber: { dispose: async () => { attachedSessions.delete(id); } } },
	});
}
makeAttached("s-live", { withAgent: false });
makeAttached("s-idle");
makeAttached("s-running", { running: true });

// Real host builds for the router's runtime seams; skipped gracefully when
// this checkout is not present (the ready-path tests then report and stop).
let zReal;
let canonicalHeaderReal;
let installModelSelectionReal;
try {
	const { pathToFileURL } = await import("node:url");
	zReal = (await import(pathToFileURL("D:/.dsh/deepseek-harness/vendor/schemastery/lib/index.cjs").href)).default;
	canonicalHeaderReal = (await import(pathToFileURL("D:/.dsh/deepseek-harness/packages/core/session/lib/index.js").href)).canonicalHeader;
	installModelSelectionReal = (await import(pathToFileURL("D:/.dsh/deepseek-harness/packages/core/agent/lib/index.js").href)).installModelSelection;
} catch { /* off-machine */ }

function mrMergeLayers(under, over) {
	if (over === undefined) return under;
	if (under === undefined) return over;
	if (typeof under !== "object" || under === null || Array.isArray(under) || typeof over !== "object" || over === null || Array.isArray(over)) return over;
	const merged = { ...under };
	for (const [key, value] of Object.entries(over)) merged[key] = key in merged ? mrMergeLayers(merged[key], value) : value;
	return merged;
}

function makeMemorySettings(z2) {
	void z2;
	const sections = new Map();
	const registrations = new Map();
	const writeSection = async (ns, section, expectedRevision) => {
		const reg = registrations.get(ns);
		if (reg === undefined) throw new Error("settings namespace \"" + ns + "\" is not registered");
		if (Number.isInteger(expectedRevision) && expectedRevision !== reg.revision) {
			const error = new Error("settings namespace \"" + ns + "\" moved past revision " + expectedRevision);
			error.name = "SettingsConflictError";
			throw error;
		}
		sections.set(ns, structuredClone(section));
		reg.resolveValue();
		reg.revision += 1;
		reg.cb?.();
	};
	return {
		writable: true,
		register(ns, schema, options) {
			if (registrations.has(ns)) throw new Error("settings namespace \"" + ns + "\" is already registered");
			const reg = { ns, revision: 0, resolved: undefined };
			reg.resolveValue = () => {
				// Mirror SettingsProvider.resolve: one callable-schema pass over
				// mergeLayers(base, userSection) applies defaults + validation.
				reg.resolved = schema(mrMergeLayers(options?.base, sections.get(ns)));
				options?.validate?.(reg.resolved);
				return reg.resolved;
			};
			reg.resolved = reg.resolveValue();
			registrations.set(ns, reg);
			return {
				get: () => reg.resolved,
				watch: (cb) => { reg.cb = cb; return () => { reg.cb = undefined; }; },
				update: async () => {},
				replace: async (section, expectedRevision) => writeSection(ns, section, expectedRevision),
			};
		},
		describe: () => [...registrations.values()].map((reg) => ({ ns: reg.ns, value: reg.resolved, revision: reg.revision })),
		get(ns) { return registrations.get(ns)?.resolved; },
		replace: async (ns, section, expectedRevision) => writeSection(ns, section, expectedRevision),
	};
}

if (zReal !== undefined && canonicalHeaderReal !== undefined) {
	mod.testHooks.seedAppModule("@deepseek-ai/dsh-session", { canonicalHeader: canonicalHeaderReal });
	if (installModelSelectionReal !== undefined) mod.testHooks.seedAppModule("@deepseek-ai/dsh-agent", { installModelSelection: installModelSelectionReal });
	mod.testHooks.seedAppModule("@deepseek-ai/schemastery", { default: zReal });
}
// Scheduler: seed a minimal createUserMessage so delivery does not depend on
// the real dsh-llm build being importable from this checkout.
mod.testHooks.seedAppModule("@deepseek-ai/dsh-llm", {
	createUserMessage: (input) => ({ id: "smoke-" + Math.random().toString(36).slice(2), role: "user", ...input }),
});


const dir = await mkdtemp(join(tmpdir(), "dsh-better-test-"));
const artifact = join(dir, "session-s-archived.jsonl");
const artifactGone = join(dir, "session-s-gone.jsonl");
const artifactIdle = join(dir, "session-s-idle.jsonl");
await writeFile(artifact, '{"seq":0}\n', "utf8");
await writeFile(artifactGone, '{"seq":0}\n', "utf8");
await writeFile(artifactIdle, '{"seq":0}\n', "utf8");

// Deterministic checkout discovery: a fake source tree + env override, armed
// BEFORE any route fires (install discovery memoizes on first use).
const checkoutDir = join(dir, "checkout");
await mkdir(join(checkoutDir, "apps", "cli"), { recursive: true });
await writeFile(join(checkoutDir, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n", "utf8");
await writeFile(join(checkoutDir, "apps", "cli", "package.json"), JSON.stringify({ name: "@deepseek-ai/dsh", version: "0.0.0-smoke" }), "utf8");
process.env.DSH_BETTER_REPO_ROOT = checkoutDir;

const ctx = {
  effect: (body, label) => { body(); return () => {}; },
  logger: { warn: (m) => warnings.push(m) },
  emit(event, ...args) { emittedEvents.push([event, ...args]); },
  loader: { entries: () => [{ id: "workspace", options: { name: "@deepseek-ai/dsh-workspace" }, fiber: { restart: async () => { restarts += 1; } } }] },
  get(service) { if (service === "workspaceRegistry") return fakeRegistry; return undefined; },
  storageDomain: { get: (n) => n === "workspace" ? {
    global: { get: () => domainState, set: async (v) => { Object.assign(domainState, v); } },
    table: (t) => ({
      entries: () => records.entries(),
      update: async (k, fn) => { const next = fn(records.get(k)); records.set(k, next); return next; },
    }),
  } : undefined },
  on(event, cb) {
    const list = eventHandlers.get(event) ?? [];
    list.push(cb);
    eventHandlers.set(event, list);
    return () => { const i = list.indexOf(cb); if (i >= 0) list.splice(i, 1); };
  },
  settings: makeMemorySettings(zReal),
  get(service) {
    if (service === "sessions") {
      return {
        get: (id) => attachedSessions.get(String(id)) ?? (id === "s-live" ? { id } : undefined),
      };
    }
    if (service === "llm") return llmStub;
    if (service === "agents") return {
      list: () => [fakeAgent],
      get: (id) => {
        if (String(id) === "session-main") return fakeAgent;
        return agentBySession.get(String(id)) ?? liveAgents.get(String(id)) ?? coldAgents.get(String(id));
      },
      roots: () => [...liveAgents.values(), ...coldAgents.values()],
    };
    if (service === "sessionController") {
      return {
        resolveAgent: async (sessionId) => {
          const id = String(sessionId);
          const cold = coldAgents.get(id);
          if (cold !== undefined) return { agent: cold };
          return { error: { message: "session not found: " + id } };
        },
      };
    }
    if (service === "workspaceRegistry") {
      return fakeRegistry;
    }
    if (service === "tools") return { register: (def) => { registeredTools.push(def); return () => {}; } };
    if (service === "agentDefaultModel") return { currentSelection: () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }) };
    if (service === "sessionPersistence") return {
      supportsRawArtifacts: true,
      locate: (header) => header.id === "s-archived" ? { kind: "jsonl", path: artifact }
        : header.id === "s-gone" ? { kind: "jsonl", path: artifactGone }
        : header.id === "s-idle" ? { kind: "jsonl", path: artifactIdle } : undefined,
      list: async () => [
        { id: "session-ws1-a", cwd: "C:/proj", createdAt: Date.parse("2026-02-03T04:05:06Z") },
        { id: "session-ws1-b", cwd: "C:/proj", createdAt: Date.parse("2026-02-01T04:05:06Z") },
        { id: "session-cold", cwd: "C:/proj", createdAt: Date.parse("2026-01-03T04:05:06Z") },
        { id: "session-cold2", cwd: "D:/elsewhere", createdAt: Date.parse("2026-01-02T04:05:06Z") },
        { id: "s-archived", cwd: "C:/proj", createdAt: Date.parse("2026-02-03T04:05:06Z") },
        { id: "s-gone", cwd: "C:/proj", createdAt: Date.parse("2026-01-03T04:05:06Z") },
        { id: "s-idle", cwd: "C:/proj", createdAt: Date.parse("2026-01-02T04:05:06Z") },
      ],
    };
    return undefined;
  },
  webServer: { register: (route) => { routes.set(route.path, route.handler); return () => routes.delete(route.path); } },
};

await mod.apply(ctx);
assert.ok(routes.has(mod.LIST_PATH) && routes.has(mod.RESTORE_PATH) && routes.has(mod.DELETE_PATH));
console.log("routes registered:", [...routes.keys()].join(", "));

// peer address helpers
const okReq = (method) => ({ method, socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:3080", ...(method === "POST" ? { "content-type": "application/json" } : {}) }, on() {} });
const foreignReq = { method: "POST", socket: { remoteAddress: "192.168.1.9" }, headers: { host: "lan-box:3080" }, on() {} };
function makeRes() {
  const res = { statusCode: undefined, body: undefined, writeHead(code) { this.statusCode = code; }, end(b) { this.body = b; } };
  return res;
}

// foreign caller refused
{
  const res = makeRes();
  routes.get(mod.DELETE_PATH)(foreignReq, res);
  assert.equal(res.statusCode, 403);
}
// wrong method refused
{
  const res = makeRes();
  routes.get(mod.DELETE_PATH)({ ...okReq("GET"), on() {}, headers: okReq("GET").headers }, res);
  assert.equal(res.statusCode, 405);
}
// cross-site "simple request" without the JSON content-type refused (CSRF fence)
{
  const req = okReq("POST");
  req.headers = { host: "127.0.0.1:3080" }; // no content-type: what a cross-origin form/fetch sends
  req.on = (ev, cb) => { if (ev === "end") cb(); };
  const res = makeRes();
  routes.get(mod.DELETE_PATH)(req, res);
  assert.equal(res.statusCode, 415);
}
// list
{
  const res = makeRes();
  routes.get(mod.LIST_PATH)(okReq("GET"), res);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.items.length, 6);
  assert.equal(body.items[0].artifact.kind, "jsonl");
  console.log("list OK:", JSON.stringify(body.items[0]));
}
await new Promise((r) => setTimeout(r, 10));

// restore
{
  const req = okReq("POST"); let bodyText;
  req.on = (ev, cb) => { if (ev === "data") {} if (ev === "end") { bodyText = JSON.stringify({ sessionId: "s-archived" }); cb(); } };
  const chunks = [Buffer.from(JSON.stringify({ sessionId: "s-archived" }))];
  req.on = (ev, cb) => { if (ev === "data") cb(chunks[0]); if (ev === "end") cb(); };
  const res = makeRes();
  routes.get(mod.RESTORE_PATH)(req, res);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(res.statusCode, 200, res.body);
  assert.deepEqual(JSON.parse(res.body), { ok: true, refreshed: "in-place" });
  assert.equal(restarts, 0, "in-place sync must not restart the registry entry");
  assert.deepEqual(domainState.archivedSessionIds, ["s-gone", "s-orphan", "s-idle", "s-running", "s-live"]);
  assert.equal(registryMirror.state.archivedSessionIds.join(","), "s-gone,s-orphan,s-idle,s-running,s-live", "registry mirror re-synced");
  assert.equal(fakeEntities.get("w1").record, records.get("w1"), "entity record snapshot swapped to the domain record");
  console.log("restore OK (in-place); archive set:", domainState.archivedSessionIds.join(","));
}

// delete
{
  const chunks = [Buffer.from(JSON.stringify({ sessionId: "s-gone" }))];
  const req = okReq("POST");
  req.on = (ev, cb) => { if (ev === "data") cb(chunks[0]); if (ev === "end") cb(); };
  const res = makeRes();
  routes.get(mod.DELETE_PATH)(req, res);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(records.get("w1").sessionIds.includes("s-gone"), false);
  assert.deepEqual(domainState.archivedSessionIds, ["s-orphan", "s-idle", "s-running", "s-live"]);
  assert.equal(JSON.parse(res.body).refreshed, "in-place", "delete also syncs in place");
  assert.equal(registryMirror.state.archivedSessionIds.join(","), "s-orphan,s-idle,s-running,s-live");
  assert.equal(fakeEntities.get("w1").record.sessionIds.includes("s-gone"), false, "entity mirror dropped the deleted id");
  let exists = true;
  try { await readFile(artifactGone); } catch { exists = false; }
  assert.equal(exists, false, "artifact should be unlinked");
  const keptArtifact = await readFile(artifact, "utf8");
  assert.ok(keptArtifact.length > 0, "unrelated artifact must survive");
  console.log("delete OK; workspace record:", JSON.stringify(records.get("w1").sessionIds), "; restarts:", restarts);
}

// fallback restart: a registry whose shape the in-place sync does not
// recognize (no setState) must degrade to the counted loader-entry restart.
{
  fakeRegistry.setState = undefined;
  fakeRegistry.entities = undefined;
  const chunks = [Buffer.from(JSON.stringify({ sessionId: "s-orphan" }))];
  const req = okReq("POST");
  req.on = (ev, cb) => { if (ev === "data") cb(chunks[0]); if (ev === "end") cb(); };
  const res = makeRes();
  routes.get(mod.DELETE_PATH)(req, res);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(res.statusCode, 200, res.body);
  assert.equal(JSON.parse(res.body).refreshed, "restart", "unrecognized shape falls back to the restart");
  assert.equal(restarts, 1, "fallback restart happened exactly once");
  assert.equal(domainState.archivedSessionIds.includes("s-orphan"), false);
  fakeRegistry.setState = (next) => { registryMirror.state = next; };
  fakeRegistry.entities = fakeEntities;
  console.log("fallback restart OK");
}

// archive delete × attached-session matrix:
// (a) attached with no agent → refused 409 (cannot detach)
// (b) attached idle → detached via fiber.dispose, artifact unlinked, removed broadcast
// (c) attached RUNNING → refused 409, nothing written
// (d) cold → plain delete + removed broadcast
{
	const postDelete = async (sessionId) => {
		const req = okReq("POST");
		req.on = (ev, cb) => { if (ev === "data") cb(Buffer.from(JSON.stringify({ sessionId }))); if (ev === "end") cb(); };
		const res = makeRes();
		routes.get(mod.DELETE_PATH)(req, res);
		await new Promise((r) => setTimeout(r, 40));
		return { status: res.statusCode, body: JSON.parse(res.body) };
	};
	const emitted = (name) => emittedEvents.filter((row) => row[0] === name).length;

	// (a) attached, un-detachable → 409, durable state untouched
	{
		const out = await postDelete("s-live");
		assert.equal(out.status, 409);
		assert.equal(out.body.error, "session-live");
		assert.ok(domainState.archivedSessionIds.includes("s-live"), "refused delete must not touch the archive set");
		assert.ok(attachedSessions.has("s-live"), "refused delete must not detach");
	}

	// (b) attached idle → detach + delete + broadcast
	{
		const out = await postDelete("s-idle");
		assert.equal(out.status, 200, JSON.stringify(out.body));
		assert.equal(out.body.detached, true, "idle session detached through its fiber");
		assert.equal(attachedSessions.has("s-idle"), false, "idle session left the store");
		assert.deepEqual(domainState.archivedSessionIds.filter((v) => String(v) === "s-idle"), [], "archive set dropped the id");
		let exists = true;
		try { await readFile(artifactIdle); } catch { exists = false; }
		assert.equal(exists, false, "idle artifact unlinked after detach");
	}
	assert.equal(emittedEvents.some((row) => row[0] === "api-session/removed" && row[1] === "s-idle"), true, "removed broadcast for the detached id");

	// (c) attached running → 409 refusal
	{
		const beforeEmits = emitted("api-session/removed");
		const out = await postDelete("s-running");
		assert.equal(out.status, 409);
		assert.equal(out.body.error, "session-live");
		assert.ok(attachedSessions.has("s-running"), "running session must stay attached");
		assert.ok(domainState.archivedSessionIds.includes("s-running"), "running refusal must not touch the archive set");
		assert.equal(emitted("api-session/removed"), beforeEmits, "refusal must not broadcast");
	}

	// (d) cold archived id → delete + broadcast (extends the earlier cold delete)
	{
		const beforeEmits = emitted("api-session/removed");
		domainState.archivedSessionIds = [...domainState.archivedSessionIds, "s-coldarch"];
		const out = await postDelete("s-coldarch");
		assert.equal(out.status, 200, JSON.stringify(out.body));
		assert.equal(out.body.detached, false, "cold delete needs no detach");
		assert.ok(!domainState.archivedSessionIds.includes("s-coldarch"), "cold id dropped");
		assert.equal(emitted("api-session/removed"), beforeEmits + 1, "exactly one removed broadcast");
		assert.equal(emittedEvents.at(-1)[1], "s-coldarch", "broadcast carries the deleted id");
	}
	console.log("archive delete × attached-session matrix OK (refuse/detach/running/cold)");
}

// update-check across three stubbed-source scenarios + cache behavior
{
  assert.ok(routes.has(mod.UPDATE_PATH), "update-check route registered");
  const originalFetch = mod.testHooks.fetch;
  const ATOM_OK = '<feed xmlns="http://www.w3.org/2005/Atom">'
    + '<entry><id>tag:github.com,2008:Repository/123/dsh-v8.8.8-rc.9</id>'
    + '<title>DSH v8.8.8-rc.9</title>'
    + '<link rel="alternate" type="text/html" href="https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v8.8.8-rc.9"/>'
    + '<updated>2026-08-22T00:00:00Z</updated></entry></feed>';

  try {
    // (a) latest → 404 (all-prerelease repo), list OK first try; cached after
    {
      mod.testHooks.reset();
      let fetchCalls = 0;
      mod.testHooks.fetch = async (url) => {
        fetchCalls += 1;
        if (String(url).includes("/releases/latest")) return { ok: false, status: 404 };
        assert.ok(String(url).includes("/releases?per_page=10"), "fallback list url");
        return {
          ok: true,
          status: 200,
          json: async () => [
            { tag_name: "dsh-v9.9.9-rc.1", draft: false, prerelease: true, name: "DSH v9.9.9-rc.1", html_url: "https://example.com/r", published_at: "2026-08-20T00:00:00Z" },
            { tag_name: "dsh-v0.0.1-draft", draft: true },
          ],
        };
      };
      const res = makeRes();
      routes.get(mod.UPDATE_PATH)(okReq("GET"), res);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(res.statusCode, 200, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.current.root, checkoutDir);
      // Machine-dependent: a pnpm-shim node makes discovery find the global
      // packaged install; a stock node leaves the running app unknown. Accept both.
      const kindOk = body.current.installKind === "unknown"
        || (body.current.installKind === "packaged" && typeof body.current.version === "string");
      assert.ok(kindOk, "install kind: " + JSON.stringify(body.current));
      assert.equal(body.latest.version, "9.9.9-rc.1");
      assert.equal(body.latest.prerelease, true);
      assert.equal(body.status, body.current.installKind === "packaged" ? "update-available" : "unknown");
      assert.equal(typeof body.checkedAt === "string", true);
      const res2 = makeRes();
      routes.get(mod.UPDATE_PATH)(okReq("GET"), res2);
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(fetchCalls, 2, "fresh cache must skip every upstream call (latest + list = 2)");
      console.log("update-check (list fallback) OK:", JSON.stringify({ status: body.status, latest: body.latest.version }));
    }

    // (b) api.github.com outage: latest 404 + list 504 twice → atom feed wins
    {
      mod.testHooks.reset();
      let fetchCalls = 0;
      mod.testHooks.fetch = async (url) => {
        fetchCalls += 1;
        const u = String(url);
        if (u.includes("/releases/latest")) return { ok: false, status: 404 };
        if (u.includes("/releases?per_page=10")) return { ok: false, status: 504 };
        assert.ok(u.endsWith("releases.atom"), "atom fallback url");
        return { ok: true, status: 200, text: async () => ATOM_OK };
      };
      const res = makeRes();
      routes.get(mod.UPDATE_PATH)(okReq("GET"), res);
      await new Promise((r) => setTimeout(r, 1200));
      assert.equal(res.statusCode, 200, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body.latest && body.latest.version, "8.8.8-rc.9");
      assert.equal(body.latest.prerelease, true);
      assert.equal(fetchCalls, 4, "latest(1) + list×2(retry) + atom(1)");
      console.log("update-check (atom fallback after 504s) OK; upstream calls:", fetchCalls);
    }

    // (c) every source fails → structured error; an immediate repeat fast-fails
    //     on the failure marker without touching upstream again
    {
      mod.testHooks.reset();
      let fetchCalls = 0;
      mod.testHooks.fetch = async () => { fetchCalls += 1; return { ok: false, status: 500 }; };
      const res = makeRes();
      routes.get(mod.UPDATE_PATH)(okReq("GET"), res);
      await new Promise((r) => setTimeout(r, 2500));
      assert.equal(res.statusCode, 200, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body.latest, null);
      assert.ok(String(body.latestError).includes("http-500"), "aggregated error: " + body.latestError);
      assert.equal(fetchCalls, 5, "full chain = latest(1) + list×2 + atom×2");
      const res2 = makeRes();
      routes.get(mod.UPDATE_PATH)(okReq("GET"), res2);
      await new Promise((r) => setTimeout(r, 150));
      assert.equal(JSON.parse(res2.body).latestError, body.latestError, "repeat serves the remembered failure");
      assert.equal(fetchCalls, 5, "failure marker must fast-fail the immediate retry");
      console.log("update-check (total failure + fast-fail) OK:", body.latestError);
    }

    // (d) dequeued + deduplicated: two parallel checks join ONE upstream chain
    {
      mod.testHooks.reset();
      let fetchCalls = 0;
      mod.testHooks.fetch = async (url) => {
        fetchCalls += 1;
        if (String(url).includes("/releases/latest")) return { ok: false, status: 404 };
        await new Promise((r2) => setTimeout(r2, 40)); // widen the race window
        return {
          ok: true,
          status: 200,
          json: async () => [
            { tag_name: "dsh-v9.9.9-rc.1", draft: false, prerelease: true, name: "DSH v9.9.9-rc.1", html_url: "https://example.com/r", published_at: "2026-08-20T00:00:00Z" },
          ],
        };
      };
      const resA = makeRes();
      const resB = makeRes();
      routes.get(mod.UPDATE_PATH)(okReq("GET"), resA);
      routes.get(mod.UPDATE_PATH)(okReq("GET"), resB);
      await new Promise((r) => setTimeout(r, 400));
      assert.equal(resA.statusCode, 200, resA.body);
      assert.equal(resB.statusCode, 200, resB.body);
      assert.equal(JSON.parse(resA.body).latest.version, "9.9.9-rc.1");
      assert.equal(JSON.parse(resB.body).latest.version, "9.9.9-rc.1");
      assert.equal(fetchCalls, 2, "parallel checks must share one chain (latest + list), not double it");
      console.log("update-check (dequeued, parallel dedupe) OK; upstream calls:", fetchCalls);
    }
  } finally {
    mod.testHooks.fetch = originalFetch;
    mod.testHooks.reset();
  }
}

// open-terminal: stubbed spawner, opens at the discovered root
{
  let spawnedAt;
  const originalSpawner = mod.testHooks.spawnTerminal;
  mod.testHooks.spawnTerminal = async (target) => { spawnedAt = target; return { pid: 4321 }; };
  try {
    const chunks = [Buffer.from("{}")];
    const req = okReq("POST");
    req.on = (ev, cb) => { if (ev === "data") cb(chunks[0]); if (ev === "end") cb(); };
    const res = makeRes();
    routes.get(mod.TERMINAL_PATH)(req, res);
    await new Promise((r) => setTimeout(r, 800)); // discovery re-walks the fs after reset(); give it room
    assert.equal(res.statusCode, 200, res.body);
    const body = JSON.parse(res.body);
    assert.equal(body.ok, true);
    assert.equal(body.opened, checkoutDir);
    assert.equal(spawnedAt, checkoutDir);
    assert.equal(body.pid, 4321);

    // foreign callers stay fenced out here too
    const resForeign = makeRes();
    routes.get(mod.TERMINAL_PATH)(foreignReq, resForeign);
    assert.equal(resForeign.statusCode, 403);
    console.log("open-terminal OK; loopback fence holds");
  } finally {
    mod.testHooks.spawnTerminal = originalSpawner;
  }
}

// ── model routing: pure logic tables ─────────────────────────────────────────
{
	// matchRule: order, first-match-wins, disabled skip, case folding, miss
	const rules = [
		{ id: "a", enabled: true, keywords: ["架构"], target: { provider: "p", model: "m" } },
		{ id: "b", enabled: false, keywords: ["架构"], target: { provider: "p", model: "m2" } },
		{ id: "c", enabled: true, keywords: ["Summary"], target: { provider: "p", model: "m3" } },
	];
	assert.equal(mod.matchRule(rules, "帮我做架构 review", false)?.id, "a");
	assert.equal(mod.matchRule(rules, "summary please", false)?.id, "c");
	assert.equal(mod.matchRule(rules, "summary please", true), undefined, "case-sensitive miss");
	assert.equal(mod.matchRule(rules, "无关内容", false), undefined);
	assert.equal(mod.matchRule([], "x", false), undefined);
	console.log("matchRule table OK");

	// resolveRouterConfig: normalization + rejections
	const cfg = mod.resolveRouterConfig({
		enabled: true, matchCase: false,
		rules: [{ id: " r1 ", keywords: [" 汇总 ", ""], target: { provider: " p ", model: " m ", reasoningEffort: " high " } }],
		agentSwitch: { enabled: true, allow: [{ provider: "a", model: "b" }] },
	});
	assert.deepEqual(cfg.rules[0].keywords, ["汇总"]);
	assert.equal(cfg.rules[0].target.provider, "p");
	assert.equal(cfg.rules[0].target.reasoningEffort, "high");
	assert.equal(cfg.agentSwitch.allow.length, 1);
	assert.throws(() => mod.resolveRouterConfig({ rules: [{ id: "x", keywords: ["k"], target: { provider: "p", model: "" } }] }), /model 不能为空/);
	assert.throws(() => mod.resolveRouterConfig({
		rules: [
			{ id: "dup", keywords: ["a"], target: { provider: "p", model: "m" } },
			{ id: "dup", keywords: ["b"], target: { provider: "p", model: "m" } },
		],
	}), /重复/);
	assert.throws(() => mod.resolveRouterConfig({ rules: [{ id: "nokey", keywords: [], target: { provider: "p", model: "m" } }] }), /keywords/);
	console.log("resolveRouterConfig table OK");

	// selectionEquals
	assert.equal(mod.selectionEquals({ provider: "a", model: "b" }, { provider: "a", model: "b" }), true);
	assert.equal(mod.selectionEquals({ provider: "a", model: "b", reasoningEffort: undefined }, { provider: "a", model: "b", reasoningEffort: "high" }), false);

	// model_route tool: allowlist gate + apply path
	{
		let appliedTo;
		const tool = mod.createModelRouteTool({
			allowlist: () => [{ provider: "deepseek-official", model: "deepseek-v4-flash" }],
			resolveTarget: async (target) => ({ selection: target }),
			apply: (agent, selection) => { appliedTo = selection; },
		});
		assert.equal(tool.name, "model_route");
		await assert.rejects(
			tool.execute({ provider: "openrouter", model: "free" }, { agent: fakeAgent, signal: new AbortController().signal }),
			(error) => error.code === "ROUTE_NOT_ALLOWED",
		);
		const value = await tool.execute({ provider: "deepseek-official", model: "deepseek-v4-flash" }, { agent: fakeAgent, signal: new AbortController().signal });
		assert.deepEqual(value.applied, { provider: "deepseek-official", model: "deepseek-v4-flash" });
		assert.deepEqual(appliedTo, { provider: "deepseek-official", model: "deepseek-v4-flash" });
		console.log("model_route tool gate OK");
	}

	// resolveTarget against the stub llm
	{
		await assert.rejects(
			mod.resolveTarget(llmStub, { provider: "ghost", model: "m" }),
			(error) => error.code === "ROUTE_PROVIDER_INACTIVE",
		);
		const resolved = await mod.resolveTarget(llmStub, { provider: "deepseek-official", model: "deepseek-v4-flash" });
		assert.deepEqual(resolved.selection, { provider: "deepseek-official", model: "deepseek-v4-flash" });
		assert.equal(resolved.reasoningEfforts.length, 2);
	}
}

// ── model routing: endpoint round-trips ──────────────────────────────────────
{
	for (const path of [mod.ROUTER_SNAPSHOT_PATH, mod.ROUTER_SAVE_PATH, mod.ROUTER_APPLY_PATH, mod.ROUTER_EFFORTS_PATH]) {
		assert.ok(routes.has(path), "route registered: " + path);
	}
	if (!(zReal !== undefined && canonicalHeaderReal !== undefined)) {
		console.log("SKIP router endpoint tests (host checkout modules unavailable)");
	} else {
		// snapshot
		{
			const res = makeRes();
			routes.get(mod.ROUTER_SNAPSHOT_PATH)(okReq("GET"), res);
			await new Promise((r) => setTimeout(r, 30));
			assert.equal(res.statusCode, 200, res.body);
			const body = JSON.parse(res.body);
			assert.equal(body.ok, true);
			assert.equal(body.available, true);
			assert.equal(body.providers.length, 2);
			assert.equal(body.providers.find((row) => row.provider === "openrouter").active, false);
			assert.equal(body.modelsByProvider["deepseek-official"][0].id, "deepseek-v4-flash");
			assert.equal(body.defaultModel.model, "deepseek-v4-flash");
			assert.equal(body.effective, null);
			console.log("router snapshot OK; providers:", body.providers.map((row) => row.provider + ":" + (row.active ? "on" : "off")).join(","));
		}

		// save → registers the model_route tool + arms rule targets
		{
			const config = {
				enabled: true,
				matchCase: false,
				rules: [{ id: "arch", keywords: ["架构"], target: { provider: "deepseek-official", model: "deepseek-v4-flash" } }],
				agentSwitch: { enabled: true, allow: [{ provider: "deepseek-official", model: "deepseek-v4-flash" }] },
			};
			const chunks = [Buffer.from(JSON.stringify({ value: config, expectedRevision: 0 }))];
			const req = okReq("POST");
			req.on = (ev, cb) => { if (ev === "data") cb(chunks[0]); if (ev === "end") cb(); };
			const res = makeRes();
			routes.get(mod.ROUTER_SAVE_PATH)(req, res);
			await new Promise((r) => setTimeout(r, 60));
			assert.equal(res.statusCode, 200, res.body);
			const body = JSON.parse(res.body);
			assert.equal(body.ok, true, res.body);
			assert.equal(body.features.modelRouteRegistered, true);
			assert.ok(registeredTools.some((tool) => tool.name === "model_route"), "model_route registered after save");
			await new Promise((r) => setTimeout(r, 40)); // let validateRuleTargets commit

			// keyword dispatch through the inbox listener
			const handlers = eventHandlers.get("agent/inbox/inserted") ?? [];
			assert.ok(handlers.length > 0, "inbox listener armed");
			for (const handler of handlers) handler({ agent: fakeAgent, message: { source: { kind: "user" }, content: [{ type: "text", text: "请帮我做架构重构" }] } });
			assert.equal(appendedHeaders.length, 1, "one session header write");
			assert.equal(appendedHeaders[0].header.config.model, "deepseek-v4-flash");
			assert.equal(appendedHeaders[0].reason, "change");
			// non-user messages never touch the session
			for (const handler of handlers) handler({ agent: fakeAgent, message: { source: { kind: "plugin" }, content: [{ type: "text", text: "架构" }] } });
			assert.equal(appendedHeaders.length, 1, "non-user message ignored");
			// no-match leaves the header alone too
			for (const handler of handlers) handler({ agent: fakeAgent, message: { source: { kind: "user" }, content: [{ type: "text", text: "今天天气不错" }] } });
			assert.equal(appendedHeaders.length, 1, "no-match ignored");

			// conflict: stale revision now rejects
			{
				const chunks2 = [Buffer.from(JSON.stringify({ value: config, expectedRevision: 0 }))];
				const req2 = okReq("POST");
				req2.on = (ev, cb) => { if (ev === "data") cb(chunks2[0]); if (ev === "end") cb(); };
				const res2 = makeRes();
				routes.get(mod.ROUTER_SAVE_PATH)(req2, res2);
				await new Promise((r) => setTimeout(r, 30));
				assert.equal(res2.statusCode, 409, res2.body);
				assert.equal(JSON.parse(res2.body).error, "conflict");
				console.log("router save + conflict + rule dispatch OK");
			}
		}

		// apply endpoint: live validation + session write + refusals
		{
			const post = (payloadObj) => {
				const chunks = [Buffer.from(JSON.stringify(payloadObj))];
				const req = okReq("POST");
				req.on = (ev, cb) => { if (ev === "data") cb(chunks[0]); if (ev === "end") cb(); };
				const res = makeRes();
				routes.get(mod.ROUTER_APPLY_PATH)(req, res);
				return res;
			};
			let res = post({ sessionId: "session-missing", target: { provider: "deepseek-official", model: "deepseek-v4-flash" } });
			await new Promise((r) => setTimeout(r, 30));
			assert.equal(res.statusCode, 404, res.body);
			res = post({ sessionId: "session-main", target: { provider: "openrouter", model: "free" } });
			await new Promise((r) => setTimeout(r, 30));
			assert.equal(res.statusCode, 400, res.body);
			assert.equal(JSON.parse(res.body).error, "ROUTE_PROVIDER_INACTIVE");
			const before = appendedHeaders.length;
			res = post({ sessionId: "session-main", target: { provider: "deepseek-official", model: "deepseek-v4-flash", reasoningEffort: "high" } });
			await new Promise((r) => setTimeout(r, 30));
			assert.equal(res.statusCode, 200, res.body);
			const body = JSON.parse(res.body);
			assert.equal(body.ok, true);
			assert.equal(body.changed, true);
			assert.equal(appendedHeaders.length, before + 1);
			assert.equal(appendedHeaders[appendedHeaders.length - 1].header.config.reasoningEffort, "high");
			console.log("router apply OK (valid, dormant-refused, missing-session)");
		}

		// efforts lookup
		{
			const req = okReq("GET");
			Object.defineProperty(req, "url", { value: mod.ROUTER_EFFORTS_PATH + "?provider=deepseek-official&model=deepseek-v4-flash" });
			const res = makeRes();
			routes.get(mod.ROUTER_EFFORTS_PATH)(req, res);
			await new Promise((r) => setTimeout(r, 30));
			assert.equal(res.statusCode, 200, res.body);
			const body = JSON.parse(res.body);
			assert.equal(body.ok, true);
			assert.equal(body.efforts[0].id, "high");
			console.log("router efforts OK:", body.efforts.map((e) => e.id).join("/"));
		}

		// foreign callers stay fenced on every new route
		const foreignGet = { method: "GET", socket: { remoteAddress: "192.168.1.9" }, headers: { host: "lan-box:3080" }, on() {} };
		for (const path of [mod.ROUTER_SNAPSHOT_PATH, mod.ROUTER_EFFORTS_PATH]) {
			const res = makeRes();
			routes.get(path)(foreignGet, res);
			assert.equal(res.statusCode, 403);
		}
		const postRes = makeRes();
		routes.get(mod.ROUTER_SAVE_PATH)(foreignReq, postRes);
		assert.equal(postRes.statusCode, 403);
		console.log("router loopback fence holds");
	}
}

// ── heartbeat & scheduled tasks: pure logic tables ───────────────────────────
{
	// parseSchedulerClock
	assert.equal(mod.parseSchedulerClock("09:07"), "09:07");
	assert.equal(mod.parseSchedulerClock(" 23:59 "), "23:59");
	assert.equal(mod.parseSchedulerClock("24:00"), null);
	assert.equal(mod.parseSchedulerClock("9:07"), null);
	assert.equal(mod.parseSchedulerClock(""), null);
	assert.equal(mod.parseSchedulerClock(undefined), null);

	// schedulerCronKey: local wall-clock minute identity
	const sample = Date.parse("2026-03-15T10:30:00Z");
	assert.equal(mod.schedulerCronKey(sample).length, 16);
	assert.equal(mod.schedulerCronKey(sample), mod.schedulerCronKey(sample + 30 * 1000));
	assert.notEqual(mod.schedulerCronKey(sample), mod.schedulerCronKey(sample + 61 * 1000));

	// computeNextCronAt: daily always tomorrow-or-today at HH:mm
	const from = new Date();
	from.setHours(10, 0, 0, 0);
	const fromMs = from.getTime();
	const nextDaily = mod.computeNextCronAt({ kind: "daily", time: "09:00" }, fromMs);
	assert.equal(nextDaily, fromMs + 23 * 3600 * 1000, "daily 09:00 after 10:00 fires tomorrow");
	const nextDailyToday = mod.computeNextCronAt({ kind: "daily", time: "11:00" }, fromMs);
	assert.equal(nextDailyToday, fromMs + 1 * 3600 * 1000, "daily 11:00 after 10:00 fires today");
	// weekly: fires on the configured weekday at HH:mm; anchor = next HH:mm
	// occurrence, then advance whole days. Same weekday after its slot = 7 days.
	const nextWeekly = mod.computeNextCronAt({ kind: "weekly", time: "09:00", day: from.getDay() }, fromMs);
	assert.equal(nextWeekly - fromMs, (6 * 24 + 23) * 3600 * 1000, "same weekday 09:00 after 10:00 fires next week");
	const otherDay = (from.getDay() + 3) % 7;
	const nextWeeklyFar = mod.computeNextCronAt({ kind: "weekly", time: "09:00", day: otherDay }, fromMs);
	// anchor tomorrow 09:00 (+23h), then (3-1+7)%7 = 2 more days
	assert.equal(nextWeeklyFar - fromMs, (2 * 24 + 23) * 3600 * 1000);
	// monthly: Feb 30 must not overflow into March 2
	const feb = mod.computeNextCronAt({ kind: "monthly", time: "09:00", date: 30 }, Date.parse("2026-02-01T10:00:00"));
	const febDate = new Date(feb);
	assert.equal(febDate.getFullYear() === 2026 || febDate.getFullYear() === 2027, true);
	assert.equal(febDate.getDate(), 30, "never overflows to a wrong date");
	// malformed
	assert.equal(mod.computeNextCronAt({ kind: "daily", time: "99:99" }, fromMs), null);
	assert.equal(mod.computeNextCronAt({ kind: "off", time: "09:00" }, fromMs), null);
	console.log("scheduler time tables OK");

	// cronMatchesNow honors weekday/date only at the exact minute
	const monday = Date.parse("2026-03-16T09:07:00"); // a Monday, local
	assert.equal(mod.cronMatchesNow({ kind: "daily", time: "09:07" }, monday), true);
	assert.equal(mod.cronMatchesNow({ kind: "daily", time: "09:08" }, monday), false);
	assert.equal(mod.cronMatchesNow({ kind: "weekly", time: "09:07", day: 1 }, monday), true);
	assert.equal(mod.cronMatchesNow({ kind: "weekly", time: "09:07", day: 2 }, monday), false);
	assert.equal(mod.cronMatchesNow({ kind: "monthly", time: "09:07", date: 16 }, monday), true);
	assert.equal(mod.cronMatchesNow({ kind: "monthly", time: "09:07", date: 15 }, monday), false);
	console.log("cronMatchesNow table OK");

	// resolveSchedulerConfig (v2 task list): clamps + rejections. Enabled
	// tasks with a bad time/shape THROW (save → 400); disabled fall back
	// leniently. The v1 singleton shape is migrated transparently.
	const cfg = mod.resolveSchedulerConfig({ version: 2, tasks: [
		{ id: "hb1", type: "heartbeat", enabled: true, intervalMinutes: 2, prompt: "", target: { kind: "session", sessionId: "session-x" } },
		{ id: "cr1", type: "cron", enabled: false, schedule: { kind: "weekly", time: "7:5", day: 9 }, prompt: "x", target: { kind: "root" } },
	] });
	assert.equal(cfg.tasks.length, 2);
	assert.equal(cfg.tasks[0].intervalMinutes, 5, "interval clamped to 5");
	assert.equal(cfg.tasks[1].schedule.time, "09:00", "invalid time falls back when disabled");
	assert.equal(cfg.tasks[1].schedule.day, 6, "day clamped into 0..6");
	assert.throws(() => mod.resolveSchedulerConfig({ version: 2, tasks: [{ id: "cr1", type: "cron", enabled: true, schedule: { kind: "off" } }] }), /触发类型/);
	assert.throws(() => mod.resolveSchedulerConfig({ version: 2, tasks: [{ id: "cr2", type: "cron", enabled: true, schedule: { kind: "daily", time: "7:5" } }] }), /触发时间/);
	assert.throws(() => mod.resolveSchedulerConfig({ version: 2, tasks: [{ id: "hb9", type: "heartbeat", enabled: true, target: { kind: "session" } }] }), /sessionId/);
	assert.throws(() => mod.resolveSchedulerConfig({ version: 2, tasks: [{ id: "dup", type: "heartbeat" }, { id: "dup", type: "cron" }] }), /重复/);
	assert.throws(() => mod.resolveSchedulerConfig({ version: 2, tasks: Array.from({ length: 21 }, (_, i) => ({ id: "t" + i, type: "heartbeat" })) }), /上限/);

	// v1 singleton migration: configured rows keep enabled + ids; a pristine
	// default namespace migrates to an EMPTY list (no placeholder tasks).
	const migrated = mod.resolveSchedulerConfig({
		heartbeat: { enabled: true, intervalMinutes: 2, prompt: "", target: { kind: "session", sessionId: "session-x" } },
		cron: { enabled: false, schedule: { kind: "weekly", time: "7:5", day: 9 }, prompt: "x", target: { kind: "root" } },
	});
	assert.equal(migrated.version, 2);
	assert.equal(migrated.tasks.length, 2, "both configured rows survive");
	assert.equal(migrated.tasks[0].id, "hb0");
	assert.equal(migrated.tasks[0].intervalMinutes, 5);
	assert.equal(migrated.tasks[1].id, "cr0");
	assert.equal(migrated.tasks[1].schedule.day, 6);
	const blankMigrated = mod.resolveSchedulerConfig({});
	assert.equal(blankMigrated.tasks.length, 0, "blank namespace migrates empty");
	console.log("resolveSchedulerConfig (multi-task + migration) OK");
}

// ── heartbeat & scheduled tasks: endpoint round-trips ────────────────────────
{
	for (const path of [mod.SCHED_SNAPSHOT_PATH, mod.SCHED_SAVE_PATH, mod.SCHED_RUN_PATH, mod.SCHED_TARGETS_PATH]) {
		assert.ok(routes.has(path), "scheduler route registered: " + path);
	}

	// targets: workspaces + unclaimed sessions grouped, subagents never listed
	{
		const req = okReq("GET");
		Object.defineProperty(req, "url", { value: mod.SCHED_TARGETS_PATH });
		const res = makeRes();
		routes.get(mod.SCHED_TARGETS_PATH)(req, res);
		await new Promise((r) => setTimeout(r, 30));
		assert.equal(res.statusCode, 200, res.body);
		const body = JSON.parse(res.body);
		assert.equal(body.ok, true);
		assert.equal(body.mainRoot, "C:/proj");
		const wsGroup = body.groups.find((g) => g.workspaceId === "w1");
		assert.ok(wsGroup, "workspace group present");
		// Cold sessions stay visible: registry membership ∩ persistence (3 here).
		assert.equal(wsGroup.sessions.length, 3, "live + cold registry members listed");
		const other = body.groups.find((g) => g.workspaceId === "");
		assert.ok(other, "unclaimed sessions grouped under Others");
		assert.ok(other.sessions.some((row) => row.id === "session-cold2"), "cold other-cwd session present");
		assert.ok(other.sessions.some((row) => row.id === "s-gone"), "archived id still resolvable");
		console.log("scheduler targets OK:", body.groups.map((g) => g.title + ":" + g.sessions.length).join(", "));
	}

	// save task list → runtime arms + run-now injects into live ws roots
	{
		const config = { version: 2, tasks: [
			{ id: "hb1", type: "heartbeat", name: "巡检", enabled: true, intervalMinutes: 30, prompt: "巡检 {time}", target: { kind: "root", sessionId: "" } },
			{ id: "cr1", type: "cron", name: "定点", enabled: false, schedule: { kind: "off", time: "09:00", day: 1, date: 1 }, prompt: "", target: { kind: "root", sessionId: "" } },
		] };
		const chunks = [Buffer.from(JSON.stringify({ value: config, expectedRevision: 0 }))];
		const req = okReq("POST");
		req.on = (ev, cb) => { if (ev === "data") cb(chunks[0]); if (ev === "end") cb(); };
		const res = makeRes();
		routes.get(mod.SCHED_SAVE_PATH)(req, res);
		await new Promise((r) => setTimeout(r, 30));
		assert.equal(res.statusCode, 200, res.body);
		const body = JSON.parse(res.body);
		assert.equal(body.ok, true, res.body);
		assert.equal(body.config.tasks.length, 2);
		assert.equal(body.config.tasks[0].enabled, true);
		assert.equal(body.config.tasks[0].intervalMinutes, 30);
		const hb1 = body.runtime.tasks.find((row) => row.id === "hb1");
		assert.equal(typeof hb1?.nextAt, "number", "hb1 armed");
		assert.equal(body.runtime.tasks.find((row) => row.id === "cr1")?.nextAt, null);

		// run-now with root target: injects the LIVE agents under C:/proj
		// (live-ws1-a/b from roots() + session-cold, whose cwd matches; the
		// D:/elsewhere cold agent is excluded by cwd and only woken on demand)
		const before = followups.length;
		const chunks2 = [Buffer.from(JSON.stringify({ trigger: "heartbeat", taskId: "hb1" }))];
		const req2 = okReq("POST");
		req2.on = (ev, cb) => { if (ev === "data") cb(chunks2[0]); if (ev === "end") cb(); };
		const res2 = makeRes();
		routes.get(mod.SCHED_RUN_PATH)(req2, res2);
		await new Promise((r) => setTimeout(r, 60));
		assert.equal(res2.statusCode, 200, res2.body);
		const runBody = JSON.parse(res2.body);
		assert.equal(runBody.ok, true, res2.body);
		assert.equal(runBody.injected, 3, "all live C:/proj roots got the beat");
		const injected = followups.slice(before);
		assert.ok(injected.every((row) => row.agent !== "session-cold2"), "foreign-cwd agent excluded");
		assert.ok(injected.every((row) => row.agent === "session-ws1-a" || row.agent === "session-ws1-b" || row.agent === "session-cold"));
		assert.ok(injected.every((row) => row.message.source?.kind === "plugin" && row.message.source?.plugin === "dsh-better"));
		assert.ok(injected[0].message.content[0].text.includes("巡检 "), "{time}-bearing prompt rendered");
		assert.notEqual(injected[0].message.content[0].text.indexOf("{time}"), -1 ? true : false, "placeholder replaced");
		assert.equal(injected[0].message.content[0].text.includes("{time}"), false, "placeholder must be replaced");
		console.log("heartbeat run-now (root target) OK:", runBody.detail);

		// revision conflict guard
		{
			const req3 = okReq("POST");
			req3.on = (ev, cb) => { if (ev === "data") cb(Buffer.from(JSON.stringify({ value: config, expectedRevision: 0 }))); if (ev === "end") cb(); };
			const res3 = makeRes();
			routes.get(mod.SCHED_SAVE_PATH)(req3, res3);
			await new Promise((r) => setTimeout(r, 30));
			assert.equal(res3.statusCode, 409, res3.body);
			console.log("scheduler save conflict OK");
		}
	}

	// cron run-now against a cold session: sessionController wake + followup
	{
		const config = { version: 2, tasks: [
			{ id: "hb2", type: "heartbeat", name: "心跳", enabled: false, intervalMinutes: 60, prompt: "", target: { kind: "root", sessionId: "" } },
			{ id: "cr2", type: "cron", name: "定点", enabled: true, schedule: { kind: "daily", time: "23:59", day: 1, date: 1 }, prompt: "定点任务", target: { kind: "session", sessionId: "session-cold" } },
		] };
		const req = okReq("POST");
		req.on = (ev, cb) => { if (ev === "data") cb(Buffer.from(JSON.stringify({ value: config, expectedRevision: 1 }))); if (ev === "end") cb(); };
		const res = makeRes();
		routes.get(mod.SCHED_SAVE_PATH)(req, res);
		await new Promise((r) => setTimeout(r, 30));
		assert.equal(res.statusCode, 200, res.body);
		const body = JSON.parse(res.body);
		const cr2 = body.runtime.tasks.find((row) => row.id === "cr2");
		assert.equal(typeof cr2?.nextAt, "number", "cr2 armed after enable");
		assert.equal(body.config.tasks[1].schedule.time, "23:59");

		const before = followups.length;
		const req2 = okReq("POST");
		req2.on = (ev, cb) => { if (ev === "data") cb(Buffer.from(JSON.stringify({ trigger: "cron", taskId: "cr2" }))); if (ev === "end") cb(); };
		const res2 = makeRes();
		routes.get(mod.SCHED_RUN_PATH)(req2, res2);
		await new Promise((r) => setTimeout(r, 60));
		assert.equal(res2.statusCode, 200, res2.body);
		const runBody = JSON.parse(res2.body);
		assert.equal(runBody.ok, true, res2.body);
		assert.equal(runBody.injected, 1, "cold session woken once");
		assert.equal(followups[followups.length - 1].agent, "session-cold");
		assert.equal(followups[followups.length - 1].message.content[0].text, "定点任务");
		console.log("cron run-now (cold session wake) OK:", runBody.detail);
	}

	// run-now with an unknown session reports failure through the envelope
	{
		const config = { version: 2, tasks: [
			{ id: "hb3", type: "heartbeat", name: "心跳", enabled: true, intervalMinutes: 60, prompt: "", target: { kind: "session", sessionId: "session-ghost" } },
			{ id: "cr3", type: "cron", name: "定点", enabled: false, schedule: { kind: "off", time: "09:00", day: 1, date: 1 }, prompt: "", target: { kind: "root", sessionId: "" } },
		] };
		const req = okReq("POST");
		req.on = (ev, cb) => { if (ev === "data") cb(Buffer.from(JSON.stringify({ value: config, expectedRevision: 2 }))); if (ev === "end") cb(); };
		const res = makeRes();
		routes.get(mod.SCHED_SAVE_PATH)(req, res);
		await new Promise((r) => setTimeout(r, 30));
		assert.equal(res.statusCode, 200, res.body);

		const req2 = okReq("POST");
		req2.on = (ev, cb) => { if (ev === "data") cb(Buffer.from(JSON.stringify({ trigger: "heartbeat", taskId: "hb3" }))); if (ev === "end") cb(); };
		const res2 = makeRes();
		routes.get(mod.SCHED_RUN_PATH)(req2, res2);
		await new Promise((r) => setTimeout(r, 60));
		assert.equal(res2.statusCode, 200, res2.body);
		const runBody = JSON.parse(res2.body);
		assert.equal(runBody.ok, false);
		assert.ok(String(runBody.detail).includes("唤醒失败"), "structured wake failure: " + runBody.detail);
		console.log("run-now unknown-session failure OK:", runBody.detail);
	}

	// invalid configs rejected with 400
	{
		const post = (payloadObj) => {
			const req = okReq("POST");
			req.on = (ev, cb) => { if (ev === "data") cb(Buffer.from(JSON.stringify(payloadObj))); if (ev === "end") cb(); };
			const res = makeRes();
			routes.get(mod.SCHED_SAVE_PATH)(req, res);
			return res;
		};
		let res = post({ value: { version: 2, tasks: [{ id: "crX", type: "cron", enabled: true, schedule: { kind: "off" } }] }, expectedRevision: 3 });
		await new Promise((r) => setTimeout(r, 30));
		assert.equal(res.statusCode, 400, res.body);
		res = post({ value: { version: 2, tasks: [] }, expectedRevision: 3 });
		await new Promise((r) => setTimeout(r, 30));
		assert.equal(res.statusCode, 200, "empty task list is valid: " + res.body);
		res = post({ value: {}, expectedRevision: -1 });
		await new Promise((r) => setTimeout(r, 30));
		assert.equal(res.statusCode, 400, res.body);
		res = post({});
		await new Promise((r) => setTimeout(r, 30));
		assert.equal(res.statusCode, 400, res.body);
		console.log("scheduler save validation OK");
	}

	// loopback fence covers every scheduler route
	{
		const foreignGet = { method: "GET", socket: { remoteAddress: "192.168.1.9" }, headers: { host: "lan-box:3080" }, on() {} };
		for (const path of [mod.SCHED_SNAPSHOT_PATH, mod.SCHED_TARGETS_PATH]) {
			const res = makeRes();
			routes.get(path)(foreignGet, res);
			assert.equal(res.statusCode, 403);
		}
		const res = makeRes();
		routes.get(mod.SCHED_RUN_PATH)(foreignReq, res);
		assert.equal(res.statusCode, 403);
		console.log("scheduler loopback fence holds");
	}
}

await rm(dir, { recursive: true, force: true });
console.log("ALL HOST SMOKE PASSED");
