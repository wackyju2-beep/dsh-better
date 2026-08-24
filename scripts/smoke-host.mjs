
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
  get(service) {
    if (service === "sessions") return { get: (id) => id === "s-live" ? { id } : undefined };
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
    await new Promise((r) => setTimeout(r, 30));
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

await rm(dir, { recursive: true, force: true });
console.log("ALL HOST SMOKE PASSED");
