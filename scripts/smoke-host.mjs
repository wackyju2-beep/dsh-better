
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
const domainState = { initialized: true, workspaceIds: ["w1"], archivedSessionIds: ["s-archived", "s-gone", "s-orphan"] };
const records = new Map([["w1", { path: "C:/proj", title: "proj", sessionIds: ["s-archived", "s-other"], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }]]);
let restarts = 0;

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


const dir = await mkdtemp(join(tmpdir(), "dsh-better-test-"));
const artifact = join(dir, "session-s-archived.jsonl");
const artifactGone = join(dir, "session-s-gone.jsonl");
await writeFile(artifact, '{"seq":0}\n', "utf8");
await writeFile(artifactGone, '{"seq":0}\n', "utf8");

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
  loader: { entries: () => [{ id: "workspace", options: { name: "@deepseek-ai/dsh-workspace" }, fiber: { restart: async () => { restarts += 1; } } }] },
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
    if (service === "sessions") return { get: (id) => id === "s-live" ? { id } : undefined };
    if (service === "llm") return llmStub;
    if (service === "agents") return { list: () => [fakeAgent], get: (id) => String(id) === "session-main" ? fakeAgent : undefined };
    if (service === "tools") return { register: (def) => { registeredTools.push(def); return () => {}; } };
    if (service === "agentDefaultModel") return { currentSelection: () => ({ provider: "deepseek-official", model: "deepseek-v4-flash" }) };
    if (service === "sessionPersistence") return {
      supportsRawArtifacts: true,
      locate: (header) => header.id === "s-archived" ? { kind: "jsonl", path: artifact }
        : header.id === "s-gone" ? { kind: "jsonl", path: artifactGone } : undefined,
      list: async () => [
        { id: "s-archived", cwd: "C:/proj", createdAt: Date.parse("2026-02-03T04:05:06Z") },
        { id: "s-gone", cwd: "C:/proj", createdAt: Date.parse("2026-01-03T04:05:06Z") },
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
const okReq = (method) => ({ method, socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:3080" }, on() {} });
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
// list
{
  const res = makeRes();
  routes.get(mod.LIST_PATH)(okReq("GET"), res);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.items.length, 3);
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
  assert.deepEqual(JSON.parse(res.body), { ok: true, restarted: true });
  assert.equal(restarts, 1);
  assert.deepEqual(domainState.archivedSessionIds, ["s-gone", "s-orphan"]);
  console.log("restore OK; archive set:", domainState.archivedSessionIds.join(","));
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
  assert.deepEqual(domainState.archivedSessionIds, ["s-orphan"]);
  let exists = true;
  try { await readFile(artifactGone); } catch { exists = false; }
  assert.equal(exists, false, "artifact should be unlinked");
  const keptArtifact = await readFile(artifact, "utf8");
  assert.ok(keptArtifact.length > 0, "unrelated artifact must survive");
  console.log("delete OK; workspace record:", JSON.stringify(records.get("w1").sessionIds), "; restarts:", restarts);
}


// orphan delete (archive set names it, persistence does not)
{
  const chunks = [Buffer.from(JSON.stringify({ sessionId: "s-orphan" }))];
  const req = okReq("POST");
  req.on = (ev, cb) => { if (ev === "data") cb(chunks[0]); if (ev === "end") cb(); };
  const res = makeRes();
  routes.get(mod.DELETE_PATH)(req, res);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(res.statusCode, 200, res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.removedArtifact, false);
  assert.equal(domainState.archivedSessionIds.includes("s-orphan"), false);
  console.log("orphan delete OK; archive set:", domainState.archivedSessionIds.join(","));
}

// live-session refusal
{
  const chunks = [Buffer.from(JSON.stringify({ sessionId: "s-live" }))];
  const req = okReq("POST");
  req.on = (ev, cb) => { if (ev === "data") cb(chunks[0]); if (ev === "end") cb(); };
  const res = makeRes();
  routes.get(mod.DELETE_PATH)(req, res);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(res.statusCode, 409);
  console.log("live refusal OK:", JSON.parse(res.body).error);
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

    // (c) every source fails → structured error, nothing cached to fall back on
    {
      mod.testHooks.reset();
      mod.testHooks.fetch = async () => ({ ok: false, status: 500 });
      const res = makeRes();
      routes.get(mod.UPDATE_PATH)(okReq("GET"), res);
      await new Promise((r) => setTimeout(r, 2500));
      assert.equal(res.statusCode, 200, res.body);
      const body = JSON.parse(res.body);
      assert.equal(body.latest, null);
      assert.ok(String(body.latestError).includes("http-500"), "aggregated error: " + body.latestError);
      console.log("update-check (total failure) OK:", body.latestError);
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

await rm(dir, { recursive: true, force: true });
console.log("ALL HOST SMOKE PASSED");
