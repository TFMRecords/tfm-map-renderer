import test from "node:test";
import assert from "node:assert/strict";
import { bakeNonScalingStrokes, transformPathData } from "../src/render/non-scaling-stroke.js";
import { parseTfmMap, renderTfmSvg } from "../src/index.js";
import { createMemoryAssetResolver } from "../src/node.js";

// A clip like `$Sol_Dur`: a shape in <defs> placed by a <use>, with a filled path and an outline Flash does not scale.
const CLIP = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="100" height="100" viewBox="-10 0 100 100">'
  + '<defs><g id="s"><path d="M0 0 L50 0 50 50 Z" fill="#a57b53"/><path d="M0 0 L50 0 Q60 10 50 50" fill="none" stroke="#000000" stroke-width="2.0" vector-effect="non-scaling-stroke"/></g></defs>'
  + '<use xlink:href="#s" transform="matrix(1 0 0 1 10 0)" width="100" height="100"/></svg>';

test("path data maps through a matrix with absolute commands", () => {
  assert.equal(transformPathData("M1 2 L3 4 H5 V6 Q7 8 9 10 C1 1 2 2 3 3 Z", [2, 0, 0, 3, 1, 0]), "M3 6L7 12L11 12L11 18Q15 24 19 30C3 3 5 6 7 9Z");
  assert.equal(transformPathData("m1 1 l2 0 h1 v1 z", [1, 0, 0, 1, 0, 0]), "M1 1L3 1L4 1L4 2Z");
  assert.equal(transformPathData("M0 0 A5 5 0 0 1 10 0", [1, 0, 0, 1, 0, 0]), null, "arcs are not handled");
});

test("a stretched clip keeps its non-scaling outline in pixels", () => {
  const out = bakeNonScalingStrokes(CLIP, 20, 40);
  assert.match(out, /^<svg [^>]*width="20" height="40" viewBox="0 0 20 40"><g transform="matrix\(0\.2 0 0 0\.4 2 0\)">/);
  // The use is inlined, the outline has its points in pixels (x * 0.2 + 2 + 0.2 * 10, y * 0.4) and the inverse of its parent's matrix.
  assert.match(out, /<g transform="matrix\(1 0 0 1 10 0\)"><g><path d="M0 0 L50 0 50 50 Z" fill="#a57b53"\/><path fill="none" stroke="#000000" stroke-width="2.0" d="M4 0L14 0Q16 4 14 20" transform="matrix\(5 0 0 2\.5 -20 0\)"\/><\/g><\/g>/);
  assert.doesNotMatch(out.slice(out.indexOf("</defs>")), /<use|vector-effect/, "nothing drawn is left to resvg's scaling");
  assert.match(out, /<defs><g id="s">/, "the shape stays in <defs> for anything else that uses it");
  assert.equal(bakeNonScalingStrokes(CLIP.replace(' vector-effect="non-scaling-stroke"', ""), 20, 40), null, "nothing to do without such a line");
});

test("a ground drawn with a stretched clip gets the baked picture", () => {
  const map = parseTfmMap('<C><P/><Z><S><S T="16" X="100" Y="100" L="20" H="40" P="0,0,0.3,0.2,0,0,0,0"/></S></Z></C>');
  const resolver = createMemoryAssetResolver({ $Sol_Dur: { data: Buffer.from(CLIP).toString("base64"), mime: "image/svg+xml", width: 100, height: 100 } });
  const href = /<image href="data:image\/svg\+xml;base64,([^"]+)"/.exec(renderTfmSvg(map, { assetResolver: resolver }))?.[1];
  assert.ok(href, "the plank is drawn from the clip");
  assert.match(Buffer.from(href, "base64").toString("utf8"), /viewBox="0 0 20 40".*d="M4 0L14 0Q16 4 14 20"/);
});
