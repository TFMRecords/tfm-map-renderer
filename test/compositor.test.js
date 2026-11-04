// The PNG compositor (src/raster): scenes drawn strip by strip, against hand-made scenes and against resvg.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createPictureCache, flattenScene, renderScenePng, renderSceneStrips, transformMatrix } from "../src/raster/index.js";
import { decodePng, createPngWriter } from "../src/util/png.js";
import { parseTfmMap, renderTfmScene, sceneToSvg } from "../src/index.js";
import { loadResvgPixels } from "../src/server/rasterize.js";

// A picture cache whose pictures are solid colour: the href is "#rrggbb".
const solid = createPictureCache({
  rasterize: (svg) => {
    const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg).map(Number);
    const [, href] = /href="([^"]+)"/.exec(svg);
    const m = /transform="matrix\(([^)]+)\)"/.exec(svg)[1].split(" ").map(Number);
    const [, bx, by, bw, bh] = /<image href="[^"]+" x="([^"]+)" y="([^"]+)" width="([^"]+)" height="([^"]+)"/.exec(svg).map(Number);
    const rgb = [1, 3, 5].map((i) => parseInt(href.slice(i, i + 2), 16));
    const pixels = new Uint8Array(w * h * 4);
    // Fill the pixels whose centre falls in the placed box (axis-aligned matrices only, enough for these tests).
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const u = (x + 0.5 - m[4]) / m[0], v = (y + 0.5 - m[5]) / m[3];
      if (u >= bx && u < bx + bw && v >= by && v < by + bh) pixels.set([...rgb, 255], (y * w + x) * 4);
    }
    return { pixels, width: w, height: h };
  },
});

async function draw(scene, options = {}) {
  const { width, height } = flattenScene(scene, options);
  const out = new Uint8Array(width * height * 4);
  const info = await renderSceneStrips(scene, { pictures: solid, ...options, onStrip: (rgba, y) => out.set(rgba, y * width * 4) });
  return { ...info, pixel: (x, y) => [...out.slice((y * width + x) * 4, (y * width + x) * 4 + 4)], out };
}
const svg = (children, size = "10 10") => ({ type: "svg", width: Number(size.split(" ")[0]), height: Number(size.split(" ")[1]), viewBox: `0 0 ${size}`, children });

test("transform lists become matrices as in SVG", () => {
  assert.deepEqual(transformMatrix([["translate", 3, 4], ["scale", 2]]), [2, 0, 0, 2, 3, 4]);
  const r = transformMatrix([["rotate", 90, 5, 5]]).map((n) => Math.round(n * 1e9) / 1e9 + 0);
  assert.deepEqual(r, [0, 1, -1, 0, 10, 0]);
});

test("rectangles with smoothed edges, opacity, clips and the view box scale", async () => {
  const { pixel } = await draw(svg([
    { type: "defs", children: [{ type: "clipPath", id: "c", children: [{ type: "rect", x: 0, y: 0, width: 5, height: 10 }] }] },
    { type: "rect", x: 0, y: 0, width: 10, height: 10, fill: "#0000ff" },
    { type: "g", clipPath: "c", children: [{ type: "rect", x: 2, y: 2, width: 6.5, height: 4, fill: "#ff0000", fillOpacity: 0.5 }] },
  ]));
  assert.deepEqual(pixel(0, 0), [0, 0, 255, 255]);
  assert.deepEqual(pixel(3, 3), [128, 0, 128, 255], "half red over blue");
  assert.deepEqual(pixel(6, 3), [0, 0, 255, 255], "outside the clip");
  const scaled = await draw(svg([{ type: "rect", x: 0, y: 0, width: 5, height: 5, fill: "#00ff00" }]), { width: 20, height: 20 });
  assert.deepEqual(scaled.pixel(9, 9), [0, 255, 0, 255]);
  assert.deepEqual(scaled.pixel(10, 10), [0, 0, 0, 0], "the view box fills the 20 x 20 output");
});

test("pictures are copied in device space, through clips and colour matrices; symbols are tiled", async () => {
  const { pixel } = await draw(svg([
    { type: "defs", children: [
      { type: "filter", id: "half", effect: { kind: "colorMatrix", matrix: [0.5, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0] } },
      { type: "symbol", id: "t", viewBox: "0 0 2 2", width: 2, height: 2, overflow: "hidden", children: [{ type: "image", href: "#00ff00", x: 0, y: 0, width: 4, height: 4 }] },
    ] },
    { type: "g", filter: "half", children: [{ type: "image", href: "#ff0000", x: 0, y: 0, width: 4, height: 4 }] },
    { type: "use", href: "#t", x: 5, y: 5, width: 2, height: 2 },
  ]));
  assert.deepEqual(pixel(1, 1), [128, 0, 0, 255], "red through the colour matrix");
  assert.deepEqual(pixel(6, 6), [0, 255, 0, 255]);
  assert.deepEqual(pixel(7, 7), [0, 0, 0, 0], "the symbol's overflow is hidden");
});

test("what the compositor cannot draw is counted; text is left out as resvg without fonts does", async () => {
  const { unsupported, pixel } = await draw(svg([{ type: "path", d: "M0 0C5 5 5 5 9 9", stroke: "#000" }, { type: "text", text: "1", fill: "#000" }]));
  assert.deepEqual(unsupported, { "path curve": 1 });
  assert.deepEqual(pixel(5, 5), [0, 0, 0, 0]);
});

test("lines: round caps and joins, one coat where a translucent line crosses itself, dashes", async () => {
  const { pixel } = await draw(svg([
    { type: "path", d: "M1 5L8 5L1 5", fill: "none", stroke: "#ff0000", strokeWidth: 2, strokeOpacity: 0.5, strokeLinecap: "round", strokeLinejoin: "round" },
    { type: "path", d: "M0 8.5h10", fill: "none", stroke: "#0000ff", strokeDasharray: "2 2" },
  ]));
  assert.deepEqual(pixel(4, 5), [255, 0, 0, 128], "the line drawn back over itself is painted once");
  assert.equal(pixel(0, 5)[3] > 0, true, "the round cap reaches past the end");
  assert.deepEqual([pixel(0, 8), pixel(1, 8), pixel(2, 8), pixel(3, 8)].map((p) => p[3]), [255, 255, 0, 0]);
});

test("outlines of rectangles and circles, and filled paths with the even-odd rule", async () => {
  const { pixel } = await draw(svg([
    { type: "rect", x: 2, y: 2, width: 6, height: 6, fill: "none", stroke: "#00ff00", strokeWidth: 2 },
    { type: "circle", cx: 5, cy: 5, r: 2, fill: "none", stroke: "#0000ff" },
  ]));
  assert.deepEqual(pixel(1, 1), [0, 255, 0, 255], "on the outline, with a mitred corner");
  assert.deepEqual(pixel(4, 4)[3], 0, "inside the outline, off the circle");
  assert.equal(pixel(6, 4)[2] > 0, true, "on the circle");
  const frame = await draw(svg([{ type: "path", d: "M0 0h10v10h-10zM3 3v4h4v-4z", fill: "#ff0000", fillRule: "evenodd" }]));
  assert.deepEqual(frame.pixel(1, 1), [255, 0, 0, 255]);
  assert.deepEqual(frame.pixel(5, 5), [0, 0, 0, 0], "the hole of the even-odd frame");
});

test("a glow spreads the alpha around the picture, the same across strip borders", async () => {
  const scene = svg([
    { type: "defs", children: [{ type: "filter", id: "g", effect: { kind: "glow", color: "#00ffff", blurX: 5, blurY: 5, strength: 3, passes: 3, flash: true } }] },
    { type: "g", filter: "g", children: [{ type: "rect", x: 8, y: 8, width: 4, height: 4, fill: "#ff0000" }] },
  ], "20 20");
  const whole = await draw(scene);
  assert.deepEqual(whole.pixel(10, 10), [255, 0, 0, 255], "the picture over its glow");
  assert.equal(whole.pixel(6, 10)[3] > 0 && whole.pixel(6, 10)[1] === 255, true, "cyan glow beside it");
  assert.deepEqual(whole.pixel(1, 1), [0, 0, 0, 0]);
  const strips = await draw(scene, { stripBytes: 20 * 16 * 3 });
  assert.deepEqual(strips.out, whole.out);
});

test("the picture does not depend on the strip height", async () => {
  const map = parseTfmMap(readFileSync(new URL("./maps/objects-1.xml", import.meta.url), "utf8"));
  const scene = renderTfmScene(map, {});
  const whole = await draw(scene);
  const strips = await draw(scene, { stripBytes: 800 * 16 * 7 }); // 7 rows at a time
  assert.deepEqual(strips.out, whole.out);
});

test("renderScenePng writes the strips as one PNG", async () => {
  const scene = svg([{ type: "rect", x: 0, y: 0, width: 3, height: 7, fill: "#336699" }]);
  const { png, width, height } = await renderScenePng(scene, { pictures: solid, stripBytes: 10 * 16 * 3 });
  const image = decodePng(png);
  assert.deepEqual([image.width, image.height, width, height], [10, 10, 10, 10]);
  assert.deepEqual([...image.data.slice((6 * 10 + 2) * 4, (6 * 10 + 2) * 4 + 4)], [0x33, 0x66, 0x99, 255]);
  const writer = createPngWriter({ width: 1, height: 1 });
  await assert.rejects(writer.finish(), /0 of 1 rows/);
});

test("with resvg: a map drawn by the compositor is close to resvg's picture", async (t) => {
  let rasterize, Resvg;
  try {
    rasterize = await loadResvgPixels();
    ({ Resvg } = await import("@resvg/resvg-js"));
  } catch {
    t.skip("@resvg/resvg-js is not installed");
    return;
  }
  const map = parseTfmMap(readFileSync(new URL("./maps/mirrored-4.xml", import.meta.url), "utf8"));
  const scene = renderTfmScene(map, { mirrorX: true, rotation: 10 });
  const ref = new Resvg(sceneToSvg(scene), { font: { loadSystemFonts: false } }).render().pixels;
  const out = new Uint8Array(800 * 400 * 4);
  await renderSceneStrips(scene, { pictures: createPictureCache({ rasterize }), onStrip: (rgba, y) => out.set(rgba, y * 800 * 4) });
  let off = 0;
  for (let i = 0; i < out.length; i += 4) {
    const a = ref[i + 3];
    const worst = Math.max(Math.abs(a - out[i + 3]), ...[0, 1, 2].map((c) => Math.abs((a ? (ref[i + c] * 255) / a : 0) - out[i + c]) * a / 255));
    if (worst > 48) off++;
  }
  assert.ok(off / (800 * 400) < 0.005, `${off} pixels differ`);
});
