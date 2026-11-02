// Rasteriser timings over the reference maps: plain SVG vs shared assets (src/render/share-assets.js), plus how far the pixels move.
// node bench/render-server.mjs [release] [iterations]
import { readFile, readdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { parseTfmDocument } from "../src/index.js";
import { renderTfmSvg } from "../src/render/svg.js";
import { shareSvgAssets } from "../src/render/share-assets.js";
import { loadRelease } from "../src/assets/index.js";
import { decodePng } from "../src/util/png.js";

const release = await loadRelease(process.argv[2] ?? ".assets/release");
const iterations = Number(process.argv[3] ?? 3);
const mod = await import("@resvg/resvg-js");
const { Resvg } = mod.default ?? mod;
const dir = "test/maps";
const time = (svg, width) => {
  let best = Infinity, png;
  for (let i = 0; i < iterations + 1; i++) {
    const a = performance.now();
    png = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } }).render().asPng();
    if (i) best = Math.min(best, performance.now() - a);
  }
  return { ms: best, png };
};
const rows = [];
for (const f of (await readdir(dir)).filter((n) => n.endsWith(".xml"))) {
  const { map } = parseTfmDocument(await readFile(`${dir}/${f}`, "utf8"));
  const width = map.settings.width ?? 800;
  const plain = renderTfmSvg(map, { assetResolver: release.resolver });
  const shared = shareSvgAssets(plain);
  const a = time(plain, width), b = time(shared, width);
  const pa = decodePng(a.png), pb = decodePng(b.png);
  let big = 0, max = 0;
  for (let i = 0; i < pa.data.length; i++) { const e = Math.abs(pa.data[i] - pb.data[i]); if (e > 16) big++; if (e > max) max = e; }
  rows.push({ map: f, plainKb: plain.length >> 10, sharedKb: shared.length >> 10, plainMs: +a.ms.toFixed(0), sharedMs: +b.ms.toFixed(0), pixelsOff16: Math.round(big / 4), maxDiff: max });
}
rows.sort((x, y) => y.plainMs - x.plainMs);
console.table(rows.slice(0, 12)); console.log("largest pixel diffs:", rows.sort((x, y) => y.maxDiff - x.maxDiff).slice(0, 5).map((r) => `${r.map} ${r.maxDiff} (${r.pixelsOff16}px)`).join("; "));
const mean = (k) => +(rows.reduce((s, r) => s + r[k], 0) / rows.length).toFixed(1);
console.log("mean ms plain", mean("plainMs"), "shared", mean("sharedMs"), "| worst diff", Math.max(...rows.map((r) => r.maxDiff)), "| maps", rows.length);
