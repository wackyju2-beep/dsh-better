
// dsh-better client-bundle smoke test: materialize the factory with shims and
// exercise apply() against a fake client context.
const loaded = [];
globalThis.window = {
  localStorage: { getItem: () => null, setItem: () => {}, },
  Notification: undefined,
  addEventListener: () => {},
};
globalThis.document = { createElement: () => { const el = { setAttribute(){}, get textContent(){return ""}, set textContent(v){ this._t = v; } }; createdElements.push(el); return el; }, head: { appendChild(){} } };
const createdElements = [];
globalThis.__ModuleLoader__ = { load(def) { loaded.push(def) } };
globalThis.window.__ModuleLoader__ = globalThis.__ModuleLoader__;

class ShimComponent { constructor() {} setState() {} forceUpdate() {} render() { return null; } }
ShimComponent.isReactComponent = {};
const reactShim = new Proxy({}, { get: (target, key) => {
  if (key === "Component") return ShimComponent;
  if (key === "createElement") return (type, props, ...children) => ({ type, props, children });
  if (key === "useState") return (init) => [typeof init === "function" ? init() : init, () => {}];
  if (key === "useEffect") return (fn) => {};
  if (key === "useCallback") return (fn) => fn;
  if (key === "useMemo") return (fn) => fn();
  return () => null;
}});
function makeProto() {
  return {
    handleMuxEnvelope(env) { return env; },
    handleHostEnvelope(env) { return env; },
  };
}
const proto = makeProto();
const sessionsInstance = Object.create(proto);
sessionsInstance.list = { getSnapshot: () => ({ byId: { s1: { id: "s1", displayTitle: "测试任务", title: "测试任务", origin: undefined, parentId: undefined } } }), subscribe: () => () => {} };
const registered = [];
const dictionaries = {};
const ctx = {
  sessions: sessionsInstance,
  locale: { register: (ns, dict) => { dictionaries[ns] = dict; return () => {}; }, bind: () => (key) => key },
  slots: { inject: (name, maker) => { registered.push({ name, entry: maker() }); }, register: (opts, comp) => ({ opts, comp }) },
  effect: (body, label) => { body(); return () => {}; },
};
await import("../lib/client.js");
if (loaded.length !== 1) throw new Error("bundle did not register exactly one module");
const mod = loaded[0].factory((spec) => {
  if (spec === "react") return reactShim;
  if (spec === "@deepseek-ai/dsh-client-ui-primitives") {
    const icon = (props) => ({ icon: true, size: props?.size });
    const fish = (props) => ({ fish: true, size: props?.size });
    return new Proxy({}, { get: (t, k) => k === "FishLogo" ? fish : icon });
  }
  throw new Error("unexpected require: " + spec);
});
console.log("factory exports:", Object.keys(mod).join(","));
mod.apply(ctx);
console.log("slots.inject calls:", registered.map(r => r.name).join(","));
const entry = registered.find((r) => r.name === "settings.section").entry;
console.log("section id:", entry.opts.id, "| order:", entry.opts.order, "| label:", entry.opts.label());
const injected = entry.opts.inject();
console.log("inject face keys:", Object.keys(injected).join(","));
if (injected.ctx !== ctx) throw new Error("ctx missing from inject face");

// Update-checker dictionaries registered with every required key
const dict = dictionaries["dsh-better"];
if (dict === undefined) throw new Error("locale dictionary not registered");
for (const key of ["upd.entry", "upd.entryDesc", "upd.title", "upd.current", "upd.latest",
	"upd.copy", "upd.copied", "upd.openTerm", "upd.note", "upd.noDir",
	"upd.npmTitle", "upd.srcTitle"]) {
	if (!(key in dict.zh)) throw new Error("missing zh locale key: " + key);
	if (!(key in dict.en)) throw new Error("missing en locale key: " + key);
}
if (!dict.zh["upd.note"].includes("源码构建")) throw new Error("upd.note must mention source-build-only");
if (!dict.zh["upd.note"].includes("@latest")) throw new Error("upd.note must explain the @latest suffix");
console.log("update locale keys OK (zh+en, note covers @latest suffix and 源码构建)");

// Model-routing dictionaries + the keyed tool card slot
for (const key of ["mr.entry", "mr.entryDesc", "mr.title", "mr.statusEngine", "mr.rules",
	"mr.allowTitle", "mr.addRule", "mr.addAllow", "mr.save", "mr.discard", "mr.conflict",
	"mr.cardTitle", "mr.cardNext"]) {
	if (!(key in dict.zh)) throw new Error("missing zh locale key: " + key);
	if (!(key in dict.en)) throw new Error("missing en locale key: " + key);
}
const names = registered.map((r) => r.name);
if (!names.includes("tool.call.toolview")) throw new Error("tool.call.toolview slot not injected");
const toolEntry = registered.find((r) => r.name === "tool.call.toolview").entry;
if (toolEntry.opts.key !== "model_route") throw new Error("tool card must be keyed model_route");
console.log("model-routing locale keys OK; tool card keyed:", toolEntry.opts.key);

// Scroll nav (v0.4.0): frame overlay entry, dictionaries, and injected styles
if (!names.includes("shell.overlay")) throw new Error("shell.overlay slot not injected");
const snEntry = registered.find((r) => r.name === "shell.overlay").entry;
if (snEntry.opts.id !== "dsh-better-scroll-nav") throw new Error("scroll nav must be id dsh-better-scroll-nav");
const snInjected = snEntry.opts.inject();
if (snInjected.ctx !== ctx) throw new Error("ctx missing from scroll nav inject face");
for (const key of ["sn.entry", "sn.entryDesc", "sn.title", "sn.enable", "sn.colors",
	"sn.trackColor", "sn.trackOpacity", "sn.tickColor", "sn.tickOpacity",
	"sn.hoverColor", "sn.activeColor", "sn.panelColor", "sn.customColorsDesc", "sn.imageFallback"]) {
	if (!(key in dict.zh)) throw new Error("missing zh locale key: " + key);
	if (!(key in dict.en)) throw new Error("missing en locale key: " + key);
}
if (!createdElements.some((el) => typeof el._t === "string" && el._t.includes(".dtb_sn"))) {
	throw new Error("scroll nav stylesheet (.dtb_sn*) was not installed");
}
console.log("scroll nav OK: shell.overlay entry, sn.* locale keys, .dtb_sn styles");

// Frame observation through the WRAPPED prototype
proto.handleMuxEnvelope({ payload: { type: "question/requested", sessionId: "s1", questions: [{ id: "q1", question: "选择方案", options: [{ label: "方案 A（Recommended）" }, { label: "方案 B" }] }] } });
proto.handleMuxEnvelope({ payload: { type: "question/resolved", sessionId: "s1", questionRpcId: "x" } });
proto.handleMuxEnvelope({ payload: { type: "session/event", sessionId: "s1", event: { type: "turn/end", data: { reason: { kind: "completed" } } } } });
proto.handleHostEnvelope({ payload: { type: "host/session-status", sessionId: "s1", running: true } });
proto.handleHostEnvelope({ payload: { type: "host/session-status", sessionId: "s1", running: false } });
proto.handleHostEnvelope({ payload: { type: "host/agent-error", sessionId: "s1", message: "boom: ETEST" } });
console.log("wrapped dispatch OK (no throws)");
