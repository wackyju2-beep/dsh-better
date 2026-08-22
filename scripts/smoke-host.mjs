
// dsh-better host-half integration smoke: fake ctx, exercise list/restore/delete.
import { writeFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert";

const mod = await import("../lib/index.js");
assert.equal(typeof mod.apply, "function");
console.log("host exports:", Object.keys(mod).join(","));

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

await rm(dir, { recursive: true, force: true });
console.log("ALL HOST SMOKE PASSED");
