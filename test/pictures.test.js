// The picture cache of the PNG compositor (src/raster/pictures.js).
import test from "node:test";
import assert from "node:assert/strict";
import { createPictureCache } from "../src/raster/pictures.js";
import { loadResvgPixels } from "../src/server/rasterize.js";

// A stand-in rasteriser: records the wrapper SVGs and returns transparent pixels of their size.
function fakeRasterize(calls = []) {
  return (svg) => {
    const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg).map(Number);
    calls.push(svg);
    return { pixels: new Uint8Array(w * h * 4), width: w, height: h };
  };
}
const box = { x: 0, y: 0, width: 10, height: 20 };

test("a picture is rasterised in device space: its box after the matrix, from whole pixels, with the sub-pixel offset kept", () => {
  const calls = [];
  const cache = createPictureCache({ rasterize: fakeRasterize(calls) });
  const p = cache.picture("a", [2, 0, 0, 2, 100.3, 50], box);
  assert.deepEqual([p.x0, p.y0, p.width, p.height, p.scale], [100, 50, 21, 40, 1]);
  assert.match(calls[0], /transform="matrix\(2 0 0 2 0\.25 0\)"/, "the offset is rounded to 1/8 pixel");
  const turned = cache.picture("a", [0, 1, -1, 0, 0, 0], box); // 90 degrees
  assert.deepEqual([turned.x0, turned.y0, turned.width, turned.height], [-20, 0, 20, 10]);
  assert.equal(cache.picture("a", [0, 0, 0, 0, 0, 0], box), null, "a degenerate matrix draws nothing");
});

test("placements a whole number of pixels apart share a raster; other offsets, scales or pictures do not", () => {
  const calls = [];
  const cache = createPictureCache({ rasterize: fakeRasterize(calls) });
  const a = cache.picture("a", [1, 0, 0, 1, 5.5, 3], box);
  const b = cache.picture("a", [1, 0, 0, 1, 105.5, 40], box);
  assert.equal(a.data, b.data);
  assert.equal(calls.length, 1);
  cache.picture("a", [1, 0, 0, 1, 5.25, 3], box);
  cache.picture("a", [2, 0, 0, 2, 5.5, 3], box);
  cache.picture("b", [1, 0, 0, 1, 5.5, 3], box);
  assert.equal(calls.length, 4);
  assert.deepEqual(cache.stats, { hits: 1, misses: 4, evicted: 0, rasters: 4, bytes: (11 * 20 + 11 * 20 + 21 * 40 + 11 * 20) * 4 });
});

test("rasters are evicted oldest first past maxBytes, and a picture above maxPixels is rasterised smaller", () => {
  const calls = [];
  const cache = createPictureCache({ rasterize: fakeRasterize(calls), maxBytes: 2 * 10 * 20 * 4, maxPixels: 10_000 });
  cache.picture("a", [1, 0, 0, 1, 0, 0], box);
  cache.picture("b", [1, 0, 0, 1, 0, 0], box);
  cache.picture("a", [1, 0, 0, 1, 0, 0], box); // a is now the newest
  cache.picture("c", [1, 0, 0, 1, 0, 0], box); // evicts b
  assert.equal(cache.stats.evicted, 1);
  cache.picture("a", [1, 0, 0, 1, 0, 0], box);
  assert.equal(calls.length, 3, "a stayed");
  const big = cache.picture("d", [40, 0, 0, 40, 0, 0], box); // 400 x 800 = 320000 pixels
  assert.ok(big.scale < 1 && big.width * big.height <= 10_000 + big.width + big.height);
});

test("with resvg: premultiplied pixels of the placed picture", async (t) => {
  let rasterize;
  try {
    rasterize = await loadResvgPixels();
  } catch {
    t.skip("@resvg/resvg-js is not installed");
    return;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="#ff0000" fill-opacity="0.5"/></svg>`;
  const href = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const p = createPictureCache({ rasterize }).picture(href, [3, 0, 0, 3, 7, 2], { x: 0, y: 0, width: 10, height: 10 });
  assert.deepEqual([p.x0, p.y0, p.width, p.height], [7, 2, 30, 30]);
  assert.deepEqual([...p.data.slice((15 * 30 + 15) * 4, (15 * 30 + 15) * 4 + 4)], [128, 0, 0, 128]);
});
