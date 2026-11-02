// The browser test page served at GET /test (and at / for browsers): paste map XML and a JSON config, POST it to this server, see the image or the error.
export const TEST_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>tfm render server</title>
<style>
  :root { color-scheme: light dark; --bg:#fff; --fg:#1d1d1f; --mut:#6e6e73; --line:#d2d2d7; --acc:#0b62d6; --bad:#c62828; --ok:#1b7f3b; --box:#f5f5f7; }
  @media (prefers-color-scheme: dark) { :root { --bg:#1c1c1e; --fg:#f2f2f7; --mut:#98989f; --line:#3a3a3c; --acc:#4da3ff; --bad:#ff6b6b; --ok:#5fd37f; --box:#2c2c2e; } }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--fg); font:14px/1.45 system-ui,sans-serif; }
  h1 { font-size:18px; margin:0 0 12px; }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:16px; align-items:start; }
  @media (max-width:900px) { .grid { grid-template-columns:1fr; } }
  label { display:block; font-weight:600; margin:0 0 4px; }
  textarea { width:100%; font:12px/1.4 ui-monospace,Menlo,Consolas,monospace; background:var(--box); color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:8px; resize:vertical; }
  #xml { height:260px; } #cfg { height:150px; }
  .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:8px 0; }
  button { font:inherit; padding:6px 14px; border:1px solid var(--line); border-radius:6px; background:var(--box); color:var(--fg); cursor:pointer; }
  button.primary { background:var(--acc); border-color:var(--acc); color:#fff; }
  button:disabled { opacity:.5; cursor:wait; }
  #status { color:var(--mut); } #status.bad { color:var(--bad); } #status.ok { color:var(--ok); }
  #out { background:var(--box); border:1px solid var(--line); border-radius:6px; padding:8px; min-height:120px; overflow:auto; }
  #out img { display:block; max-width:100%; image-rendering:auto; background:repeating-conic-gradient(#8884 0 25%,#0000 0 50%) 0 0/16px 16px; }
  pre { margin:8px 0 0; white-space:pre-wrap; word-break:break-word; font:12px/1.4 ui-monospace,Menlo,Consolas,monospace; }
  small { color:var(--mut); }
</style></head><body>
<h1>tfm render server — test page</h1>
<div class="grid">
  <div>
    <label for="xml">Map XML</label>
    <textarea id="xml" spellcheck="false" placeholder="&lt;C&gt;&lt;P /&gt;&lt;Z&gt;&lt;S&gt;...&lt;/S&gt;&lt;/Z&gt;&lt;/C&gt;"></textarea>
    <div class="row"><input type="file" id="file" accept=".xml,text/xml,text/plain"><button id="sample" type="button">Sample map</button></div>
    <label for="cfg">Config (JSON merged into the request body)</label>
    <textarea id="cfg" spellcheck="false">{
  "width": 800,
  "options": {}
}</textarea>
    <small>Top-level: <code>width</code>, <code>height</code>, <code>mirror</code>, <code>lenient</code>, <code>svg</code>, <code>options</code> (renderer options, e.g. <code>{"renderJoints": true}</code>). The XML above is sent as <code>xml</code>.</small>
    <div class="row"><button id="go" class="primary" type="button">Render (Ctrl+Enter)</button><span id="status"></span></div>
  </div>
  <div>
    <label>Result</label>
    <div id="out"><small>Nothing rendered yet.</small></div>
  </div>
</div>
<script>
const $ = (id) => document.getElementById(id);
const SAMPLE = '<C><P L="800" H="400" /><Z><S><S T="0" X="400" Y="380" L="800" H="40" P="0,0,0.3,0.2,0,0,0,0" /><S T="1" X="200" Y="300" L="120" H="20" P="0,0,0.3,0.2,0,0,0,0" /><S T="3" X="600" Y="300" L="120" H="20" P="0,0,0.3,0.2,0,0,0,0" /></S><D><DS X="400" Y="340" /></D><O /></Z></C>';
try { $("xml").value = localStorage.getItem("tfm-xml") || ""; $("cfg").value = localStorage.getItem("tfm-cfg") || $("cfg").value; } catch {}
$("sample").onclick = () => { $("xml").value = SAMPLE; };
$("file").onchange = async (e) => { const f = e.target.files[0]; if (f) $("xml").value = await f.text(); };
const status = (text, cls = "") => { $("status").textContent = text; $("status").className = cls; };
async function go() {
  let cfg;
  try { cfg = JSON.parse($("cfg").value || "{}"); } catch (e) { status("config is not valid JSON: " + e.message, "bad"); return; }
  const body = { ...cfg, xml: $("xml").value };
  delete body.raw;
  try { localStorage.setItem("tfm-xml", $("xml").value); localStorage.setItem("tfm-cfg", $("cfg").value); } catch {}
  $("go").disabled = true; status("rendering...");
  const t0 = performance.now();
  try {
    const res = await fetch("/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const ms = Math.round(performance.now() - t0);
    const json = await res.json();
    const out = $("out"); out.textContent = "";
    if (!res.ok || !json.image) {
      status("HTTP " + res.status + " in " + ms + " ms", "bad");
      const pre = document.createElement("pre"); pre.textContent = JSON.stringify(json, null, 2); out.append(pre); return;
    }
    status("HTTP " + res.status + " in " + ms + " ms" + (json.cached ? " (cached)" : ""), "ok");
    const img = new Image(); img.src = "data:" + json.mimeType + ";base64," + json.image; out.append(img);
    const dl = document.createElement("a"); dl.href = img.src; dl.download = "map.png"; dl.textContent = "download PNG"; out.append(dl);
    const { image, svg, ...rest } = json;
    const pre = document.createElement("pre"); pre.textContent = JSON.stringify(rest, null, 2); out.append(pre);
    if (svg) { const d = document.createElement("details"); d.innerHTML = "<summary>SVG (" + svg.length + " chars)</summary>"; const p = document.createElement("pre"); p.textContent = svg.slice(0, 20000); d.append(p); out.append(d); }
  } catch (e) { status("request failed: " + e.message, "bad"); }
  finally { $("go").disabled = false; }
}
$("go").onclick = go;
document.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") go(); });
</script></body></html>`;
