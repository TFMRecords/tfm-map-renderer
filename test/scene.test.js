// The scene (src/render/scene.js): renderTfmSvg is sceneToSvg of renderTfmScene, and the writer's rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTfmMap, renderTfmScene, renderTfmSvg, sceneToSvg } from "../src/index.js";

test("renderTfmSvg is the SVG of renderTfmScene, whose nodes are plain data", () => {
  const map = parseTfmMap(readFileSync(new URL("./maps/numeric-edge.xml", import.meta.url), "utf8"));
  for (const options of [{}, { mirrorX: true, rotation: 20 }, { minimalist: true, debugMarkers: true }]) {
    const scene = renderTfmScene(map, options);
    assert.equal(scene.type, "svg");
    assert.equal(sceneToSvg(scene), renderTfmSvg(map, options));
    assert.equal(sceneToSvg(JSON.parse(JSON.stringify(scene))), sceneToSvg(scene), "survives JSON");
  }
});

test("properties are written in order, renamed, null ones left out; children may nest and hold nulls", () => {
  const svg = sceneToSvg({
    type: "g",
    transform: [["translate", 1, 2], ["rotate", 30, 5, 6], ["scale", 0.5]],
    dataRole: "x",
    filter: "f",
    clipPath: null,
    children: [null, [{ type: "rect", width: 3, fillOpacity: 0.5, strokeWidth: undefined }], false, { type: "text", text: "a<b" }],
  });
  assert.equal(svg, '<g transform="translate(1 2) rotate(30 5 6) scale(0.5)" data-role="x" filter="url(#f)"><rect width="3" fill-opacity="0.5"/><text>a&lt;b</text></g>');
});

test("filters are written from their effect", () => {
  const matrix = { type: "filter", id: "m", effect: { kind: "colorMatrix", matrix: [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0] } };
  assert.equal(sceneToSvg(matrix), '<filter id="m" color-interpolation-filters="sRGB"><feColorMatrix type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0"/></filter>');
  const glow = sceneToSvg({ type: "filter", id: "g", region: { x: "-40%", y: "-40%", width: "180%", height: "180%" }, effect: { kind: "glow", color: "#fff", blurX: 5, blurY: 5, strength: 3, passes: 3, flash: false } });
  assert.match(glow, /^<filter id="g" color-interpolation-filters="sRGB" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur in="SourceAlpha" stdDeviation="2.5"/);
  assert.throws(() => sceneToSvg({ type: "filter", id: "x", effect: { kind: "nope" } }), /unknown filter effect/);
});
