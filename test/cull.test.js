// Culling (docs/rendering.md#culling) and the soft size limit `maxViewport` / `--max-map-size`.
import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmMap, renderTfmSvg, renderedViewport } from "../src/index.js";
import { createCuller } from "../src/render/cull.js";
import { createRenderService } from "../src/server/render-service.js";

// A ground in the corner, one 4 million units to the right, one in the far corner (turned 60 degrees).
const HUGE = '<C><P L="8000000" H="4000000"/><Z><S><S T="18" X="400" Y="300" L="800" H="200" P="0,0,0.3,0.2,0,0,0,0"/>'
  + '<S T="9" X="4000000" Y="615" L="580" H="421" P="0,0,0,0,0,0,0,0"/>'
  + '<S T="21" X="8000000" Y="4000000" L="424" H="967" P="0,0,0,0,60,0,0,0"/></S><D/><O/><L/></Z></C>';
const types = (svg) => [...svg.matchAll(/data-type="(\d+)"/g)].map((m) => Number(m[1]));

test("grounds wholly outside the viewport are left out", () => {
  const map = parseTfmMap(HUGE);
  assert.deepEqual(types(renderTfmSvg(map, { viewport: { x: 0, y: 0, width: 800, height: 400 } })), [18]);
  assert.deepEqual(types(renderTfmSvg(map, { viewport: { x: 3999600, y: 400, width: 800, height: 400 } })), [9]);
  // Mirrored, the far ground lands at x = 0.
  assert.deepEqual(types(renderTfmSvg(map, { viewport: { x: 0, y: 3999500, width: 800, height: 1000 }, mirrorX: true })), [21]);
});

test("culling keeps what reaches into the viewport after rotation, flip and camera", () => {
  const view = { x: 0, y: 0, width: 800, height: 400, mapWidth: 800 };
  const visible = createCuller(view);
  // A 2000-long bar centred 1500 to the right reaches back into the view only when it is not turned.
  const bar = { x: -1000, y: -5, width: 2000, height: 10 };
  assert.equal(visible(bar, { x: 1500, y: 200 }), true);
  assert.equal(visible(bar, { x: 1500, y: 200, rotation: 90 }), false);
  // The margin is a quarter of the view: 200 to the left still counts, 300 does not.
  assert.equal(visible({ x: -10, y: 0, width: 10, height: 10 }, { x: -190, y: 0 }), true);
  assert.equal(visible({ x: -10, y: 0, width: 10, height: 10 }, { x: -290, y: 0 }), false);
  // A flip mirrors the box around the anchor.
  assert.equal(visible({ x: 0, y: 0, width: 400, height: 10 }, { x: -500, y: 0, flip: true }), false);
  assert.equal(visible({ x: 0, y: 0, width: 400, height: 10 }, { x: 1300, y: 0, flip: true }), true);
  // The camera: mirrored, x maps to 800 - x; turned 180 degrees around the view centre, likewise (and y too).
  assert.equal(createCuller(view, { mirrorX: true })({ x: 0, y: 0, width: 1, height: 1 }, { x: 1150, y: 0 }), false);
  assert.equal(createCuller(view, { mirrorX: true })({ x: 0, y: 0, width: 1, height: 1 }, { x: -150, y: 0 }), true);
  assert.equal(createCuller(view, { rotation: 180 })({ x: 0, y: 0, width: 1, height: 1 }, { x: 900, y: 300 }), true);
});

test("maxViewport cuts the drawn part from its top-left corner", () => {
  const map = parseTfmMap(HUGE);
  const options = { maxViewport: { width: 4800, height: 3200 } };
  assert.deepEqual(renderedViewport(map, options), { cropped: true, mapWidth: 8000000, mapHeight: 4000000, x: 0, y: 0, width: 4800, height: 3200 });
  assert.match(renderTfmSvg(map, options), /^<svg [^>]*width="4800" height="3200" viewBox="0 0 4800 3200"/);
  assert.equal(renderedViewport(map, { ...options, viewport: { x: 10, y: 20, width: 800, height: 400 } }).cropped, false);
  assert.equal(renderedViewport(parseTfmMap("<C><P/><Z><S/><D/><O/></Z></C>"), options).cropped, false);
  assert.throws(() => renderTfmSvg(map), RangeError);
});

test("server maxMapSize renders a huge map cropped, with a warning", async () => {
  const rasterizer = { name: "fake", async rasterize(svg, { width, height }) { return { png: Buffer.alloc(0), width, height }; } };
  const service = createRenderService({ rasterizer, maxMapSize: { width: 4800, height: 3200 } });
  const r = await service.render({ xml: HUGE, width: 1200 });
  assert.deepEqual([r.width, r.height, r.mapWidth], [1200, 800, 8000000]);
  assert.deepEqual(r.warnings.find((w) => w.code === "map-cropped"), { code: "map-cropped", severity: "info", x: 0, y: 0, width: 4800, height: 3200 });
  const small = await service.render({ xml: "<C><P/><Z><S/><D/><O/></Z></C>" });
  assert.equal(small.warnings.some((w) => w.code === "map-cropped"), false);
});

test("above the output limits the picture is truncated: the width up to 8192, then the rows that fit", async () => {
  const seen = [];
  const rasterizer = { name: "fake", async rasterize(svg, { width, height }) { seen.push(svg); return { png: Buffer.alloc(0), width, height }; } };
  const service = createRenderService({ rasterizer });
  // 8000000 x 4000000 at scale 1: 8192 wide, then 16777216 / 8192 = 2048 rows; only that part of the map is drawn.
  const r = await service.render({ xml: HUGE });
  assert.deepEqual([r.width, r.height], [8192, 2048]);
  assert.deepEqual(r.warnings.find((w) => w.code === "image-truncated"), { code: "image-truncated", severity: "info", requestedWidth: 8000000, requestedHeight: 4000000, width: 8192, height: 2048 });
  assert.match(seen.at(-1), /viewBox="0 0 8192 2048"/);
  // An asked size keeps its scale: 8192 x 4096 for an 800 x 400 map stops after 2048 rows, which is the top half of the map.
  const asked = await service.render({ xml: '<C><P/><Z><S/><D/><O/></Z></C>', width: 8192, height: 4096 });
  assert.deepEqual([asked.width, asked.height], [8192, 2048]);
  assert.match(seen.at(-1), /viewBox="0 0 800 200"/);
  const small = await service.render({ xml: "<C><P/><Z><S/><D/><O/></Z></C>" });
  assert.equal(small.warnings.some((w) => w.code === "image-truncated"), false);
});
