// `fitContent`: the viewport is the box of everything drawn on the map, whatever the map's size (src/render/svg.js).
import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmMap, renderTfmScene } from "../src/index.js";
import { renderedViewport } from "../src/render/svg.js";
import { sceneBounds } from "../src/render/scene-bounds.js";
import { createRenderService } from "../src/server/render-service.js";

// Grounds left of and below the 800 x 400 map, and a spawn above it.
const XML = '<C><P L="800" H="400"/><Z><S><S T="0" X="-200" Y="100" L="100" H="20"/><S T="1" X="1000" Y="500" L="120" H="40"/></S><D><DS X="300" Y="-50"/></D><O/></Z></C>';
const map = parseTfmMap(XML);

/** The box of what the scene draws on the map, in view box units (the room colour left out). */
const drawn = (scene) => sceneBounds(scene.children[1]);

test("off by default; with fitContent the viewport is the content's box, from negative coordinates", () => {
  assert.deepEqual(renderedViewport(map, {}), { cropped: false, mapWidth: 800, mapHeight: 400, x: 0, y: 0, width: 800, height: 400 });
  const v = renderedViewport(map, { fitContent: true });
  const b = drawn(renderTfmScene(map, { fitContent: true }));
  // The grounds span x -250 to 1060 (with their outline); the spawn circle reaches up to y -56.5.
  assert.deepEqual([v.x, v.y, v.x + v.width, v.y + v.height], [Math.floor(b.x0), Math.floor(b.y0), Math.ceil(b.x1), Math.ceil(b.y1)]);
  assert.ok(v.x < 0 && v.y < 0);
  const scene = renderTfmScene(map, { fitContent: true, scale: 2 });
  assert.equal(scene.viewBox, `${v.x} ${v.y} ${v.width} ${v.height}`);
  assert.deepEqual([scene.width, scene.height], [v.width * 2, v.height * 2]);
});

test("an explicit viewport wins; an empty map keeps its own size", () => {
  assert.deepEqual(renderedViewport(map, { fitContent: true, viewport: { x: 0, y: 0, width: 100, height: 50 } }).width, 100);
  const empty = renderedViewport(parseTfmMap("<C><P/><Z><S/><D/><O/></Z></C>"), { fitContent: true });
  assert.deepEqual([empty.x, empty.y, empty.width, empty.height], [0, 0, 800, 400]);
});

test("mirrored and turned, the content still fills the viewport", () => {
  for (const rotation of [0, 30, 90, 180, 245, 60, -60]) {
    for (const mirrorX of [false, true]) {
      const options = { fitContent: true, rotation, mirrorX };
      const v = renderedViewport(map, options);
      const b = drawn(renderTfmScene(map, options));
      const label = JSON.stringify(options);
      assert.ok(b.x0 >= v.x - 1e-6 && b.y0 >= v.y - 1e-6 && b.x1 <= v.x + v.width + 1e-6 && b.y1 <= v.y + v.height + 1e-6, `${label}: content out of view`);
      // Tight, except mirrored near 60 degrees, where no viewport centre fits the content exactly.
      const slack = Math.max(b.x0 - v.x, b.y0 - v.y, v.x + v.width - b.x1, v.y + v.height - b.y1);
      if (!(mirrorX && Math.abs(rotation) === 60)) assert.ok(slack <= 1.01, `${label}: ${slack} units of slack`);
    }
  }
});

test("the background and the borders are not content", () => {
  const plain = renderedViewport(map, { fitContent: true });
  assert.deepEqual(renderedViewport(map, { fitContent: true, borders: "map" }), plain);
  const small = parseTfmMap('<C><P L="1600" H="800"/><Z><S><S T="0" X="100" Y="100" L="40" H="40"/></S><D/><O/></Z></C>');
  const v = renderedViewport(small, { fitContent: true, renderTiledBackgrounds: true, borders: "all" });
  assert.ok(v.width < 60 && v.height < 60, JSON.stringify(v));
});

test("the server accepts fitContent and sizes the picture to the content", async () => {
  const rasterizer = { name: "fake", async rasterize(svg, { width, height }) { return { png: Buffer.alloc(0), width, height }; } };
  const result = await createRenderService({ rasterizer }).render({ xml: XML, options: { fitContent: true } });
  const v = renderedViewport(map, { fitContent: true });
  assert.deepEqual([result.width, result.height], [v.width, v.height]);
});
