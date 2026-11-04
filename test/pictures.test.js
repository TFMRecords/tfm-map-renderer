// The picture cache of the PNG compositor (src/raster/pictures.js).
import test from "node:test";
import assert from "node:assert/strict";
import { createPictureCache } from "../src/raster/pictures.js";
import { loadResvgPixels } from "../src/server/rasterize.js";

// A stand-in rasteriser: reads the tile's size and view box back from the wrapper SVG and fills each pixel with its picture position.
function fakeRasterize(calls = []) {
  return (svg) => {
    const [, w, h, x, y] = /width="(\d+)" height="(\d+)" viewBox="(\d+) (\d+)/.exec(svg).map(Number);
    calls.push({ x, y, w, h });
    const pixels = new Uint8Array(w * h * 4);
    for (let row = 0; row < h; row++) for (let col = 0; col < w; col++) pixels.set([(x + col) & 255, (y + row) & 255, 0, 255], (row * w + col) * 4);
    return { pixels, width: w, height: h };
  };
}

test("a small picture is one tile; a large one at most 3 x 3 tiles of at least a third of its size", () => {
  const cache = createPictureCache({ rasterize: fakeRasterize(), tileSize: 100 });
  const small = cache.picture("a", 80.2, 40);
  assert.deepEqual([small.width, small.height, small.columns, small.rows], [81, 40, 1, 1]);
  const large = cache.picture("a", 1000, 250);
  assert.deepEqual([large.columns, large.rows, large.tileWidth, large.tileHeight], [3, 3, 334, 84]);
  const last = large.tile(2, 2);
  assert.deepEqual([last.x, last.y, last.width, last.height], [668, 168, 332, 82]);
  assert.deepEqual([...last.data.slice(0, 4)], [668 & 255, 168, 0, 255], "the tile holds its own part of the picture");
});

test("tiles are cached by picture, size and position, and evicted oldest first past maxBytes", () => {
  const calls = [];
  const cache = createPictureCache({ rasterize: fakeRasterize(calls), maxBytes: 2 * 10 * 10 * 4 });
  const a = cache.picture("a", 10, 10);
  assert.equal(a.tile(0, 0), cache.picture("a", 10, 10).tile(0, 0));
  assert.equal(calls.length, 1);
  cache.picture("b", 10, 10).tile(0, 0);
  a.tile(0, 0); // a is now the newest
  cache.picture("c", 10, 10).tile(0, 0); // evicts b
  assert.deepEqual(cache.stats, { hits: 2, misses: 3, evicted: 1, tiles: 2, bytes: 800 });
  cache.picture("a", 10, 10).tile(0, 0);
  assert.equal(calls.length, 3, "a stayed");
  cache.picture("a", 20, 10).tile(0, 0);
  assert.equal(calls.length, 4, "another size is another raster");
});

test("a picture too large for 3 x 3 tiles is rasterised at a lower resolution", () => {
  const cache = createPictureCache({ rasterize: fakeRasterize(), tileSize: 100, maxTilePixels: 100 * 100 });
  const p = cache.picture("a", 3000, 3000);
  assert.deepEqual([p.width, p.height, p.columns, p.rows], [300, 300, 3, 3]);
  assert.throws(() => cache.picture("a", 0, 10), /positive/);
});

test("with resvg: a tiled picture matches the whole raster", async (t) => {
  let rasterize;
  try {
    rasterize = await loadResvgPixels();
  } catch {
    t.skip("@resvg/resvg-js is not installed");
    return;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20" viewBox="0 0 30 20"><rect x="2" y="3" width="20" height="12" fill="#ff0000" fill-opacity="0.5"/><circle cx="25" cy="15" r="4" fill="#00f"/></svg>`;
  const href = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const whole = createPictureCache({ rasterize }).picture(href, 300, 200).tile(0, 0);
  assert.deepEqual([...whole.data.slice((50 * 300 + 50) * 4, (50 * 300 + 50) * 4 + 4)], [128, 0, 0, 128], "premultiplied RGBA");
  const tiled = createPictureCache({ rasterize, tileSize: 120 }).picture(href, 300, 200);
  assert.deepEqual([tiled.columns, tiled.rows], [3, 2]);
  let worst = 0;
  for (let row = 0; row < tiled.rows; row++) {
    for (let column = 0; column < tiled.columns; column++) {
      const tile = tiled.tile(column, row);
      for (let y = 0; y < tile.height; y++) {
        for (let i = 0; i < tile.width * 4; i++) worst = Math.max(worst, Math.abs(tile.data[y * tile.width * 4 + i] - whole.data[((tile.y + y) * 300 + tile.x) * 4 + i]));
      }
    }
  }
  assert.ok(worst <= 2, `tiles differ from the whole raster by ${worst}`);
});
