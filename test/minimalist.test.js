import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmMap } from "../src/index.js";
import { renderTfmSvg } from "../src/render/svg.js";

const xml = '<C><P L="800" H="400"/><Z><S><S T="0" X="100" Y="100" L="50" H="20" P="0,0,0.3,0.2,0,0,0,0"/><S T="9" X="300" Y="100" L="50" H="20" P="0,0,0.3,0.2,0,0,0,0"/><S T="12" X="500" Y="100" L="50" H="20" o="ff0000" P="0,0,0.3,0.2,0,0,0,0"/><S T="14" X="600" Y="100" L="50" H="20" P="0,0,0.3,0.2,0,0,0,0"/></S><D/><O/></Z></C>';

test("minimalist mode uses the client's flat colours", () => {
  const svg = renderTfmSvg(parseTfmMap(xml), { minimalist: true });
  assert.match(svg, /fill="#324650"/); // 3294800, type 0
  assert.match(svg, /fill="#6da7af" fill-opacity="0.3"/); // 7186351 at alpha 0.3, type 9
  assert.match(svg, /fill="#ff0000"/);
  assert.doesNotMatch(svg, /data-type="14"/);
  const normal = renderTfmSvg(parseTfmMap(xml));
  assert.doesNotMatch(normal, /fill="#324650"/);
});

test("minimalist mode drops background D images but keeps the foreground", () => {
  const withImages = parseTfmMap('<C><P L="800" H="400" D="a.png,0,0" d="b.png,0,0"/><Z><S/><D/><O/></Z></C>');
  const resolver = { resolve: ({ source }) => ({ href: `data:image/png;base64,${Buffer.from(source).toString("base64")}`, width: 10, height: 10 }) };
  const normal = renderTfmSvg(withImages, { assetResolver: resolver });
  const minimal = renderTfmSvg(withImages, { assetResolver: resolver, minimalist: true });
  const count = (svg) => (svg.match(/<image/g) ?? []).length;
  assert.equal(count(normal), 2);
  assert.equal(count(minimal), 1);
});

test("the F background is drawn from $F_n, skipped in minimalist mode, and -2 picks from the random list", () => {
  const map = parseTfmMap('<C><P L="1600" H="800" F="3"/><Z><S/><D/><O/></Z></C>');
  const seen = [];
  const resolver = { resolve: ({ source }) => { seen.push(source); return { href: "data:image/svg+xml;base64,AAAA", width: 800, height: 400, origin: { x: 0, y: 0 } }; } };
  const svg = renderTfmSvg(map, { assetResolver: resolver });
  assert.deepEqual(seen, ["$F_3"]);
  assert.match(svg, /<image[^>]*width="1600"[^>]*height="800"[^>]*preserveAspectRatio="none"/);
  seen.length = 0;
  assert.doesNotMatch(renderTfmSvg(map, { assetResolver: resolver, minimalist: true }), /<image/);
  const random = parseTfmMap('<C><P L="800" H="400" F="-2"/><Z><S/><D/><O/></Z></C>');
  renderTfmSvg(random, { assetResolver: resolver, randomBackgroundIndex: 5, compositeRandomBackground: false });
  assert.deepEqual(seen, ["$F_7"]);
});

test("F=-2 draws a composite of the client's backgrounds 0, 1, 2, 3 and 7, one vertical strip each, unless switched off", () => {
  const random = parseTfmMap('<C><P L="800" H="400" F="-2"/><Z><S/><D/><O/></Z></C>');
  const seen = [];
  const resolver = { resolve: ({ source }) => { seen.push(source); return { href: "data:image/svg+xml;base64,AAAA", width: 800, height: 400, origin: { x: 0, y: 0 } }; } };
  const svg = renderTfmSvg(random, { assetResolver: resolver });
  assert.deepEqual(seen, ["$F_0", "$F_1", "$F_2", "$F_3", "$F_7"]);
  for (const x of [0, 160, 320, 480, 640]) assert.match(svg, new RegExp(`<clipPath id="map-background-clip-\\d"><rect x="${x}" y="0" width="160" height="400"`));
  seen.length = 0;
  renderTfmSvg(random, { assetResolver: resolver, compositeRandomBackground: false });
  assert.equal(seen.length, 1);
});
