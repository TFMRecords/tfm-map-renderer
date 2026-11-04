// The browser test page served at GET /test (and at / for browsers): map XML, a form of every request field and renderer option
// (kept in step with the JSON config below it), and the answer: the PNG, the SVG (whole, previewed by the browser on request),
// the warnings and the response itself.
import { ALLOWED_OPTIONS, RENDERERS } from "./render-service.js";

/** The request fields besides the renderer options: [name, kind, default shown, help]. */
const REQUEST_FIELDS = [
  ["width", "number", "the map's", "output width in pixels; alone it keeps the aspect ratio"],
  ["height", "number", "the map's", "output height in pixels; with width it stretches the map"],
  ["renderer", RENDERERS, "the server's", "how the PNG is drawn: compositor (from the scene) or resvg (from the SVG)"],
  ["svg", "boolean", "false", "the answer also carries the SVG"],
  ["rasterize", "boolean", "true", "false: the SVG only, at its own size (needs svg)"],
  ["mapImages", "boolean", "true", "fetch and draw the map's own images (D, d, i, APS, ...)"],
  ["lenient", "boolean", "true", "false: strict XML parsing"],
];

/** Each renderer option the server accepts: [group, default shown, help] (docs/api/renderer.md#options). A test keeps it whole. */
export const OPTION_HELP = Object.freeze({
  viewport: ["View", "whole map", "the part of the map to draw, in map units"],
  scale: ["View", "1", "output pixels per map unit"],
  rotation: ["View", "0", "camera rotation in degrees, around the viewport centre"],
  mirrorX: ["View", "false", "a mirrored room"],
  borders: ["View", "none", "map: an outline of the map; all: of everything"],
  backgroundColor: ["Look", "#6a7495", "room colour behind everything; none for transparent"],
  minimalist: ["Look", "false", "the game's minimalist mode"],
  textures: ["Look", "true", "ground textures; false draws flat placeholders"],
  textureSeed: ["Look", "1", "seed of the random tile and coin choices"],
  pregeneratedBitmaps: ["Look", "false", "static grounds as the game draws them in slow mode or on mobile"],
  flashBlur: ["Look", "true", "Flash's box blurs for hole glows; false: Gaussian"],
  defaultAssets: ["Look", "true", "false: only what the asset release supplies (no placeholders, no room colour)"],
  clientLimits: ["Game", "unrestricted", "what the game would cut or switch off: unrestricted, restricted, module (or an object)"],
  restricted: ["Game", "false", "alias of clientLimits: restricted"],
  objectMode: ["Game", "editor", "editor: every object with a picture; game: only what the game creates"],
  nailVisibility: ["Game", "all", "client: the game's rules for which nails show"],
  cheeseSuffix: ["Game", "", "an event suffix for the cheese picture"],
  compositeRandomBackground: ["Game", "true", "F=-2 drawn as a strip of each candidate background; false picks one"],
  randomBackgroundIndex: ["Game", "", "which candidate F=-2 picks when not composite"],
  randomDecorationFlip: ["Game", "false", "decorations with flip code 2 flip by a seeded coin"],
  objectPlaceholders: ["Editor", "true", "a dashed placeholder for objects without a picture"],
  spawnMarkers: ["Editor", "editor", "editor (the editor's spawn pictures; circles without the asset release), circles or none (the game)"],
  debugMarkers: ["Editor", "false", "outlines at every decoration and object position"],
  renderJoints: ["Editor", "true", "joints that have a style c"],
  renderAppearingImages: ["Shown later", "false", "ARPS images, as if shown"],
  renderIpImages: ["Shown later", "false", "IP images, as if shown"],
  renderTiledBackgrounds: ["Shown later", "false", "tiled D=#url,w,h backgrounds (external images)"],
  renderSoulmateHeart: ["Shown later", "false", "the heart of A maps"],
  renderHideOffscreenFrame: ["Shown later", "false", "the frame of Ca maps around the 800 x 600 play area"],
  modules: ["Modules", "parkour: auto", "overlays of Lua modules; false hides them all"],
  parkourNails: ["Modules", "true", "the parkour overlay draws each checkpoint's nail again over its mouse"],
  parkourStyle: ["Modules", "", "look of the parkour overlay (JSON: stopColor, stopAmount, number, size)"],
});

const SCHEMA = {
  request: REQUEST_FIELDS,
  options: Object.entries(ALLOWED_OPTIONS).map(([name, rule]) => [name, rule, ...(OPTION_HELP[name] ?? ["Other", "", ""])]),
};

const PAGE = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>tfm render server</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#1d1d1f; --mut:#6e6e73; --line:#d2d2d7; --acc:#0b62d6; --bad:#c62828; --ok:#1b7f3b; --warn:#a15c00; --box:#f5f5f7; --set:#e8f0fe; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1c1c1e; --fg:#f2f2f7; --mut:#98989f; --line:#3a3a3c; --acc:#4da3ff; --bad:#ff6b6b; --ok:#5fd37f; --warn:#f0b35a; --box:#2c2c2e; --set:#1f3350; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--fg); font:14px/1.45 system-ui,sans-serif; }
  h1 { font-size:18px; margin:0; }
  header { display:flex; gap:12px; align-items:baseline; flex-wrap:wrap; margin:0 0 12px; }
  #server { color:var(--mut); font-size:12px; }
  .grid { display:grid; grid-template-columns:minmax(0,5fr) minmax(0,6fr); gap:16px; align-items:start; }
  .result { position:sticky; top:8px; }
  @media (max-width:1000px) { .grid { grid-template-columns:1fr; } .result { position:static; } }
  label.h { display:block; font-weight:600; margin:10px 0 4px; }
  textarea, input, select { font:inherit; background:var(--box); color:var(--fg); border:1px solid var(--line); border-radius:6px; }
  textarea { width:100%; font:12px/1.4 ui-monospace,Menlo,Consolas,monospace; padding:8px; resize:vertical; }
  #xml { height:200px; } #cfg { height:140px; } #cfg.bad { border-color:var(--bad); }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:8px 0; }
  button { font:inherit; padding:5px 12px; border:1px solid var(--line); border-radius:6px; background:var(--box); color:var(--fg); cursor:pointer; }
  button.primary { background:var(--acc); border-color:var(--acc); color:#fff; }
  button:disabled { opacity:.5; cursor:wait; }
  details.group { border:1px solid var(--line); border-radius:6px; margin:6px 0; padding:0 8px; }
  details.group > summary { cursor:pointer; padding:6px 0; font-weight:600; }
  details.group > summary small { font-weight:400; }
  .fields { display:grid; grid-template-columns:minmax(120px,max-content) minmax(0,1fr); gap:4px 10px; align-items:center; padding:0 0 8px; }
  .fields > .name { font:12px ui-monospace,Menlo,Consolas,monospace; }
  .fields > .name.set { background:var(--set); border-radius:4px; padding:0 4px; }
  .ctl { display:flex; gap:6px; align-items:center; flex-wrap:wrap; min-width:0; }
  .ctl input, .ctl select { padding:3px 6px; min-width:0; }
  .ctl input[type=number] { width:90px; } .ctl input[type=text] { width:150px; }
  .ctl textarea { height:60px; }
  .ctl .help { color:var(--mut); font-size:12px; flex:1 1 180px; }
  small, .mut { color:var(--mut); }
  #status { color:var(--mut); } #status.bad { color:var(--bad); } #status.ok { color:var(--ok); }
  .tabs { display:flex; gap:4px; border-bottom:1px solid var(--line); margin:0 0 8px; flex-wrap:wrap; }
  .tabs button { border-radius:6px 6px 0 0; border-bottom:none; }
  .tabs button.on { background:var(--acc); border-color:var(--acc); color:#fff; }
  .pane { display:none; } .pane.on { display:block; }
  .view { background:var(--box); border:1px solid var(--line); border-radius:6px; padding:8px; overflow:auto; max-height:calc(100vh - 190px); }
  .view img { display:block; background:repeating-conic-gradient(#8884 0 25%,#0000 0 50%) 0 0/16px 16px; }
  .view.fit img { max-width:100%; height:auto; }
  .summary { display:flex; flex-wrap:wrap; gap:4px 14px; margin:0 0 8px; font-size:13px; }
  .summary b { font-weight:600; }
  .error { color:var(--bad); font-weight:600; margin:0 0 8px; white-space:pre-wrap; }
  pre { margin:0; white-space:pre-wrap; word-break:break-word; font:12px/1.4 ui-monospace,Menlo,Consolas,monospace; }
  #svgsrc { height:60vh; }
  table { border-collapse:collapse; width:100%; font-size:13px; }
  td, th { border-bottom:1px solid var(--line); padding:4px 6px; text-align:left; vertical-align:top; }
  td code { font-size:12px; }
  .sev-warning { color:var(--warn); } .sev-error { color:var(--bad); }
  a { color:var(--acc); }
</style></head><body>
<header><h1>tfm render server</h1><span id="server"></span></header>
<div class="grid">
  <div>
    <label class="h" for="xml">Map XML</label>
    <textarea id="xml" spellcheck="false" placeholder="&lt;C&gt;&lt;P /&gt;&lt;Z&gt;&lt;S&gt;...&lt;/S&gt;&lt;/Z&gt;&lt;/C&gt;"></textarea>
    <div class="row"><input type="file" id="file" accept=".xml,text/xml,text/plain"><button id="sample" type="button">Sample map</button></div>
    <div class="row"><button id="go" class="primary" type="button">Render (Ctrl+Enter)</button><button id="goSvg" type="button">SVG only</button><span id="status"></span></div>
    <label class="h">Request <small class="mut">(empty: the default; set fields are highlighted)</small></label>
    <div id="form"></div>
    <div class="row"><button id="reset" type="button">Reset all to defaults</button></div>
    <label class="h" for="cfg">Config <small class="mut">(JSON sent with the XML; the form above edits it, and it edits the form)</small></label>
    <textarea id="cfg" spellcheck="false"></textarea>
    <small id="cfgerr" class="mut"></small>
  </div>
  <div class="result">
    <div class="tabs" id="tabs">
      <button type="button" data-tab="png" class="on">PNG</button>
      <button type="button" data-tab="svg">SVG</button>
      <button type="button" data-tab="info">Details</button>
      <button type="button" data-tab="raw">Response</button>
    </div>
    <div id="summary" class="summary"><span class="mut">Nothing rendered yet.</span></div>
    <div id="err" class="error"></div>
    <div class="pane on" id="pane-png">
      <div class="row"><button type="button" id="fit">Actual size</button><a id="dlpng" download="map.png" hidden>Download PNG</a><a id="openpng" target="_blank" hidden>Open in a new tab</a></div>
      <div class="view fit" id="pngview"><span class="mut">No PNG.</span></div>
    </div>
    <div class="pane" id="pane-svg">
      <div class="row">
        <button type="button" id="svgprev" class="primary">Preview SVG</button>
        <button type="button" id="svgshow">Show source</button>
        <button type="button" id="svgcopy">Copy</button>
        <a id="dlsvg" download="map.svg" hidden>Download SVG</a>
        <span id="svginfo" class="mut"></span>
      </div>
      <small class="mut">The preview is your browser's drawing of the SVG, not the server's PNG. Without an SVG in the answer, the buttons ask the server for it (svg only, nothing rasterised).</small>
      <div class="view fit" id="svgview" hidden></div>
      <textarea id="svgsrc" spellcheck="false" readonly hidden></textarea>
    </div>
    <div class="pane" id="pane-info"><div id="info" class="mut">Nothing yet.</div></div>
    <div class="pane" id="pane-raw"><div class="view"><pre id="raw" class="mut">Nothing yet.</pre></div></div>
  </div>
</div>
<script>
const SCHEMA = __SCHEMA__;
const $ = (id) => document.getElementById(id);
const el = (tag, props, ...kids) => { const e = document.createElement(tag); Object.assign(e, props || {}); for (const k of kids) if (k != null) e.append(k); return e; };
const SAMPLE = '<C><P L="800" H="400" /><Z><S><S T="0" X="400" Y="380" L="800" H="40" P="0,0,0.3,0.2,0,0,0,0" /><S T="1" X="200" Y="300" L="120" H="20" P="0,0,0.3,0.2,0,0,0,0" /><S T="3" X="600" Y="300" L="120" H="20" P="0,0,0.3,0.2,0,0,0,0" /></S><D><DS X="400" Y="340" /></D><O /></Z></C>';
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// --- The config: one object, shown as JSON and as the form.
let cfg = { width: 800, options: {} };
try { const saved = store.get("tfm-cfg"); if (saved) cfg = JSON.parse(saved); } catch {}
$("xml").value = store.get("tfm-xml") || "";
const refreshers = [];
function writeCfg() { $("cfg").value = JSON.stringify(cfg, null, 2); $("cfg").classList.remove("bad"); $("cfgerr").textContent = ""; store.set("tfm-cfg", $("cfg").value); }
function refreshForm() { for (const r of refreshers) r(); }
const opts = () => (cfg.options && typeof cfg.options === "object" ? cfg.options : (cfg.options = {}));
function setValue(scope, name, value) {
  const target = scope === "options" ? opts() : cfg;
  if (value === undefined) delete target[name]; else target[name] = value;
  writeCfg(); refreshForm();
}
const getValue = (scope, name) => (scope === "options" ? opts()[name] : cfg[name]);

function control(scope, name, rule, def) {
  const get = () => getValue(scope, name);
  const set = (v) => setValue(scope, name, v);
  const choice = (values, fmt) => {
    const s = el("select");
    s.append(el("option", { value: "", textContent: "default (" + def + ")" }));
    for (const v of values) s.append(el("option", { value: JSON.stringify(v), textContent: fmt ? fmt(v) : String(v) }));
    s.onchange = () => set(s.value === "" ? undefined : JSON.parse(s.value));
    return [s, () => { const v = get(); const key = v === undefined ? "" : JSON.stringify(v); s.value = [...s.options].some((o) => o.value === key) ? key : ""; }];
  };
  if (rule === "boolean") return choice([true, false]);
  if (Array.isArray(rule)) return choice(rule);
  if (rule === "number") {
    const i = el("input", { type: "number", step: "any", placeholder: def });
    i.onchange = () => set(i.value === "" ? undefined : Number(i.value));
    return [i, () => { const v = get(); i.value = typeof v === "number" ? String(v) : ""; }];
  }
  if (rule === "string" || rule === "string-or-null") {
    const i = el("input", { type: "text", placeholder: def });
    i.onchange = () => set(i.value === "" ? undefined : i.value);
    return [i, () => { const v = get(); i.value = typeof v === "string" ? v : v === null ? "none" : ""; }];
  }
  if (rule === "preset-or-object") return choice(["unrestricted", "restricted", "module"]);
  if (rule === "modules") return choice([false, { parkour: true }, { parkour: false }, { parkour: "auto" }], (v) => (v === false ? "none (false)" : "parkour: " + v.parkour));
  if (rule === "viewport") {
    const box = el("span", { className: "ctl" });
    const inputs = ["x", "y", "width", "height"].map((k) => { const i = el("input", { type: "number", step: "any", placeholder: k, title: k }); box.append(i); return [k, i]; });
    const update = () => {
      const v = {};
      for (const [k, i] of inputs) if (i.value !== "") v[k] = Number(i.value);
      set(Object.keys(v).length ? v : undefined);
    };
    for (const [, i] of inputs) i.onchange = update;
    return [box, () => { const v = get() || {}; for (const [k, i] of inputs) i.value = typeof v[k] === "number" ? String(v[k]) : ""; }];
  }
  // JSON objects (parkourStyle) and anything else: a JSON text box.
  const t = el("textarea", { spellcheck: false, placeholder: "JSON, e.g. {\"stopColor\":\"#ff3300\"}" });
  t.onchange = () => { if (t.value.trim() === "") { set(undefined); return; } try { set(JSON.parse(t.value)); t.classList.remove("bad"); } catch { t.style.borderColor = "var(--bad)"; } };
  return [t, () => { const v = get(); t.style.borderColor = ""; if (document.activeElement !== t) t.value = v === undefined ? "" : JSON.stringify(v); }];
}

function buildForm() {
  const groups = new Map();
  const add = (group, scope, name, rule, def, help) => {
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push({ scope, name, rule, def, help });
  };
  for (const [name, rule, def, help] of SCHEMA.request) add("Request", "body", name, rule, def, help);
  for (const [name, rule, group, def, help] of SCHEMA.options) add(group, "options", name, rule, def, help);
  const form = $("form");
  for (const [group, fields] of groups) {
    const box = el("div", { className: "fields" });
    const count = el("small");
    for (const f of fields) {
      const label = el("span", { className: "name", textContent: f.name, title: f.scope === "options" ? "options." + f.name : f.name });
      const [ctl, refresh] = control(f.scope, f.name, f.rule, f.def);
      box.append(label, el("span", { className: "ctl" }, ctl, el("span", { className: "help", textContent: f.help })));
      refreshers.push(() => { refresh(); label.classList.toggle("set", getValue(f.scope, f.name) !== undefined); });
    }
    refreshers.push(() => { const n = fields.filter((f) => getValue(f.scope, f.name) !== undefined).length; count.textContent = n ? " " + n + " set" : ""; });
    form.append(el("details", { className: "group", open: group === "Request" || group === "View" }, el("summary", {}, group, count), box));
  }
}
buildForm();
writeCfg(); refreshForm();
$("cfg").oninput = () => {
  try {
    const v = JSON.parse($("cfg").value || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    cfg = v; $("cfg").classList.remove("bad"); $("cfgerr").textContent = ""; store.set("tfm-cfg", $("cfg").value); refreshForm();
  } catch (e) { $("cfg").classList.add("bad"); $("cfgerr").textContent = "not valid JSON: " + e.message; }
};
$("reset").onclick = () => { cfg = { options: {} }; writeCfg(); refreshForm(); };
$("sample").onclick = () => { $("xml").value = SAMPLE; };
$("file").onchange = async (e) => { const f = e.target.files[0]; if (f) $("xml").value = await f.text(); };

// --- Server info.
fetch("/health").then((r) => r.json()).then((h) => {
  $("server").textContent = "renderer " + h.backend + " · " + (h.release ? "asset release loaded" : "placeholder art") + " · map images " + (h.mapImages ? "on" : "off")
    + (h.rasterizerProcesses ? " · " + h.rasterizerProcesses + " rasterizer processes" : "");
}).catch(() => {});

// --- Tabs and views.
function tab(name) {
  for (const b of $("tabs").children) b.classList.toggle("on", b.dataset.tab === name);
  for (const p of document.querySelectorAll(".pane")) p.classList.toggle("on", p.id === "pane-" + name);
}
$("tabs").onclick = (e) => { if (e.target.dataset.tab) tab(e.target.dataset.tab); };
$("fit").onclick = () => { const fit = $("pngview").classList.toggle("fit"); $("svgview").classList.toggle("fit", fit); $("fit").textContent = fit ? "Actual size" : "Fit to width"; };
const status = (text, cls) => { $("status").textContent = text; $("status").className = cls || ""; };
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : (n / 1024).toFixed(1) + " KB");
let last = { body: null, json: null, svg: null, pngUrl: null, svgUrl: null };

function requestBody(extra) {
  const body = { ...cfg, ...extra, xml: $("xml").value };
  delete body.raw;
  return body;
}

async function post(body) {
  const t0 = performance.now();
  const res = await fetch("/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  const ms = Math.round(performance.now() - t0);
  let json;
  try { json = JSON.parse(text); } catch { json = { error: text }; }
  return { res, json, ms, bytes: text.length };
}

function setSvg(svg) {
  last.svg = svg;
  if (last.svgUrl) URL.revokeObjectURL(last.svgUrl);
  last.svgUrl = svg ? URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) : null;
  $("dlsvg").hidden = !svg; if (svg) $("dlsvg").href = last.svgUrl;
  $("svginfo").textContent = svg ? kb(svg.length) + " of SVG" : "";
  $("svgview").hidden = true; $("svgsrc").hidden = true;
}

function showResult({ res, json, ms, bytes }, body) {
  last.body = body; last.json = json;
  const ok = res.ok && !json.error;
  status("HTTP " + res.status + " in " + ms + " ms" + (json.cached ? " (cached)" : ""), ok ? "ok" : "bad");
  $("err").textContent = json.error ? json.error : "";
  // Summary.
  const s = $("summary"); s.textContent = "";
  const item = (k, v) => { if (v !== undefined && v !== null && v !== "") s.append(el("span", {}, el("b", { textContent: k + " " }), String(v))); };
  item("HTTP", res.status); item("time", ms + " ms"); item("backend", json.backend);
  if (json.width) item("output", json.width + " x " + json.height);
  if (json.mapWidth) item("map", json.mapWidth + " x " + json.mapHeight);
  item("answer", kb(bytes)); if (json.image) item("PNG", kb(json.image.length * 0.75));
  if (json.clientLoads === false) item("game", "would not load the map");
  if (json.warnings) item("warnings", json.warnings.length);
  if (json.cached) item("cached", "yes");
  // PNG.
  const view = $("pngview"); view.textContent = "";
  if (json.image) {
    const url = "data:" + (json.mimeType || "image/png") + ";base64," + json.image;
    view.append(el("img", { src: url, alt: "rendered map" }));
    $("dlpng").href = url; $("dlpng").hidden = false;
    $("openpng").hidden = false;
    $("openpng").onclick = (e) => { e.preventDefault(); fetch(url).then((r) => r.blob()).then((b) => window.open(URL.createObjectURL(b), "_blank")); };
  } else {
    view.append(el("span", { className: "mut", textContent: json.error ? "No PNG: the render failed." : "No PNG (SVG only)." }));
    $("dlpng").hidden = true; $("openpng").hidden = true;
  }
  // SVG, when the answer has it (also with an error).
  setSvg(json.svg || null);
  // Details: warnings, map images, the rest.
  const info = $("info"); info.textContent = ""; info.className = "";
  const warnings = json.warnings || [];
  info.append(el("label", { className: "h", textContent: "Warnings (" + warnings.length + ")" }));
  if (warnings.length) {
    const table = el("table", {}, el("tr", {}, el("th", { textContent: "code" }), el("th", { textContent: "severity" }), el("th", { textContent: "details" })));
    for (const w of warnings) {
      const { code, severity, ...restW } = w;
      table.append(el("tr", {}, el("td", {}, el("code", { textContent: code || "" })), el("td", { className: "sev-" + severity, textContent: severity || "" }),
        el("td", {}, el("code", { textContent: Object.keys(restW).length ? JSON.stringify(restW) : "" }))));
    }
    info.append(table);
  } else info.append(el("div", { className: "mut", textContent: "none" }));
  if (json.mapImages) info.append(el("label", { className: "h", textContent: "Map images" }), el("pre", { textContent: JSON.stringify(json.mapImages, null, 2) }));
  info.append(el("label", { className: "h", textContent: "Request sent (xml left out)" }), el("pre", { textContent: JSON.stringify({ ...body, xml: "(" + body.xml.length + " characters)" }, null, 2) }));
  // The whole answer, with the image and SVG shown by size (the SVG tab holds the SVG whole).
  const shown = { ...json };
  if (shown.image) shown.image = "(" + shown.image.length + " base64 characters: the PNG tab)";
  if (shown.svg) shown.svg = "(" + shown.svg.length + " characters: the SVG tab)";
  $("raw").textContent = JSON.stringify(shown, null, 2); $("raw").className = "";
  tab(json.image ? "png" : json.svg ? "svg" : json.error ? "info" : "png");
}

async function go(extra) {
  const body = requestBody(extra);
  store.set("tfm-xml", $("xml").value);
  $("go").disabled = $("goSvg").disabled = true; status("rendering...");
  try { showResult(await post(body), body); if (extra && last.svg) previewSvg(); }
  catch (e) { status("request failed: " + e.message, "bad"); }
  finally { $("go").disabled = $("goSvg").disabled = false; }
}

// The SVG of the last request: from its answer, else asked for (svg only, not rasterised).
async function ensureSvg() {
  if (last.svg) return last.svg;
  const body = { ...(last.body || requestBody()), svg: true, rasterize: false, xml: last.body ? last.body.xml : $("xml").value };
  $("svginfo").textContent = "asking the server for the SVG...";
  const { res, json } = await post(body);
  if (!json.svg) { $("svginfo").textContent = "no SVG: HTTP " + res.status + " " + (json.error || ""); return null; }
  setSvg(json.svg);
  return json.svg;
}
async function previewSvg() {
  if (!(await ensureSvg())) return;
  const v = $("svgview"); v.textContent = "";
  v.append(el("img", { src: last.svgUrl, alt: "SVG preview" }));
  v.hidden = false; $("svgsrc").hidden = true; tab("svg");
}
$("svgprev").onclick = previewSvg;
$("svgshow").onclick = async () => { if (!(await ensureSvg())) return; $("svgsrc").value = last.svg; $("svgsrc").hidden = false; $("svgview").hidden = true; };
$("svgcopy").onclick = async () => { if (!(await ensureSvg())) return; try { await navigator.clipboard.writeText(last.svg); $("svginfo").textContent = "copied " + kb(last.svg.length); } catch (e) { $("svginfo").textContent = "copy failed: " + e.message; } };
$("go").onclick = () => go();
$("goSvg").onclick = () => go({ svg: true, rasterize: false });
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") go(); });
</script></body></html>`;

export const TEST_PAGE = PAGE.replace("__SCHEMA__", () => JSON.stringify(SCHEMA).replace(/</g, "\\u003c"));
