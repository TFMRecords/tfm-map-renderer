import test from "node:test";
import assert from "node:assert/strict";
import { decodePng, encodePng } from "../src/util/png.js";
import { alignImages, regionErrors, diffImage, autoRegions, rmse, backgroundColor } from "../src/util/compare.js";
import { parseTfmMap } from "../src/index.js";

function scene(width, height, blobs, bg = [106, 116, 149]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) { data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255; }
  for (const [x0, y0, w, h, c] of blobs) for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
    const i = (y * width + x) * 4;
    // a little texture so only the right alignment fits
    const u = x - x0, v = y - y0;
    data[i] = (c[0] + ((u * 7 + v * 3) % 40)) & 255; data[i + 1] = (c[1] + ((u * 5 + v * 11) % 30)) & 255; data[i + 2] = c[2];
  }
  return { width, height, data };
}
const blobs = [[100, 80, 40, 30, [200, 40, 40]], [300, 200, 50, 50, [40, 180, 60]], [500, 300, 30, 40, [220, 200, 20]], [650, 120, 60, 25, [30, 60, 200]]];

test("PNG encode and decode round-trip an RGBA image", () => {
  const image = scene(37, 23, [[3, 4, 10, 8, [250, 10, 10]]]);
  const back = decodePng(encodePng(image));
  assert.equal(back.width, 37);
  assert.equal(back.height, 23);
  assert.deepEqual([...back.data], [...image.data]);
});

test("alignImages finds where a render sits inside a larger, offset screenshot, even when the background matches everywhere", () => {
  const ours = scene(800, 400, blobs);
  // the screenshot: the same scene shifted by (+37, +21) inside a 900x460 window (the game's window margin), plus a bar over the top rows
  const shot = scene(900, 460, blobs.map(([x, y, w, h, c]) => [x + 37, y + 21, w, h, c]));
  const found = alignImages(ours, shot);
  assert.deepEqual([found.dx, found.dy], [37, 21]);
  assert.ok(found.rmse < 0.5);
});

test("alignImages copes with a screenshot that is a crop of the window (the render hangs out of it)", () => {
  const ours = scene(800, 400, blobs);
  const whole = scene(800, 400, blobs);
  // crop x 250..600, y 150..400 of the scene
  const w = 350, h = 250, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) data.set(whole.data.subarray(((150 + y) * 800 + 250) * 4, ((150 + y) * 800 + 600) * 4), y * w * 4);
  const found = alignImages(ours, { width: w, height: h, data });
  assert.deepEqual([found.dx, found.dy], [-250, -150]);
});

test("regionErrors reports 0 for identical regions and a large error for a different one; diffImage and autoRegions", () => {
  const ours = scene(800, 400, blobs);
  const shot = scene(800, 400, [...blobs.slice(0, 3), [650, 120, 60, 25, [200, 200, 200]]]);
  const [same, different] = regionErrors(ours, shot, { dx: 0, dy: 0 }, [{ label: "a", x: 90, y: 70, w: 70, h: 60 }, { label: "b", x: 640, y: 110, w: 80, h: 50 }], 0);
  assert.equal(same.rmse, 0);
  assert.ok(different.rmse > 20);
  assert.equal(rmse(ours, ours, { x: 0, y: 0, w: 800, h: 400 }).rmse, 0);
  assert.deepEqual(backgroundColor(ours), [106, 116, 149]);
  const diff = diffImage(ours, ours, { dx: 0, dy: 0 });
  assert.equal(diff.data.reduce((m, v, i) => (i % 4 === 3 ? m : Math.max(m, v)), 0), 0);
  const map = parseTfmMap('<C><P L="800" H="400"/><Z><S><S T="12" X="100" Y="50" L="40" H="20"/></S><D><P T="5" X="300" Y="100" P="0,0"/></D><O><O C="1" X="200" Y="60"/></O></Z></C>');
  const plain = autoRegions(map);
  assert.equal(plain.length, 3);
  assert.equal(plain[0].x, 78);          // ground: 40 + 4 wide, centred on x = 100
  const mirrored = autoRegions(map, { mirrorWidth: 800 });
  assert.equal(mirrored[0].x, 800 - 100 - 22);
});
