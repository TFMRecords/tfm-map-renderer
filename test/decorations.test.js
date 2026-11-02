import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmMap } from "../src/index.js";
import { renderTfmSvg } from "../src/render/svg.js";

const seen = [];
const resolver = {
  resolve: (ref) => {
    seen.push(ref.key ?? ref.source);
    return String(ref.key ?? ref.source).startsWith("$P_") ? { href: "data:image/svg+xml;utf8,x", width: 50, height: 40, origin: { x: 20, y: 30 } } : null;
  },
};
const xml = '<C><P L="800" H="400"/><Z><S/><D><P X="100" Y="200" T="306" P="0,0"/><P X="200" Y="200" T="306" P="0,1"/><P X="300" Y="200" T="12" P="0,0"/><DS X="5" Y="5"/></D><O/></Z></C>';

test("decorations are drawn from $P_<type> with the registration point at (x, y), mirrored by inversion code 1", () => {
  seen.length = 0;
  const svg = renderTfmSvg(parseTfmMap(xml), { assetResolver: resolver });
  assert.ok(seen.includes("$P_306") && seen.includes("$P_12"));
  assert.match(svg, /<g transform="translate\(100 200\)"><image[^>]*x="-20" y="-30"/);
  assert.match(svg, /<g transform="translate\(200 200\) scale\(-1 1\)"><image/);
});

test("minimalist mode and a resolver without the clip draw no decorations", () => {
  assert.doesNotMatch(renderTfmSvg(parseTfmMap(xml), { assetResolver: resolver, minimalist: true }), /translate\(100 200\)/);
  assert.doesNotMatch(renderTfmSvg(parseTfmMap(xml), { assetResolver: { resolve: () => null } }), /translate\(100 200\)/);
});

test("an explicit resolveDecorationAsset callback replaces the default lookup", () => {
  seen.length = 0;
  renderTfmSvg(parseTfmMap(xml), { assetResolver: resolver, resolveDecorationAsset: () => "custom.png" });
  assert.deepEqual([...new Set(seen)], ["custom.png"]);
});

test("P = 0,2 (random flip in the client) is drawn unflipped unless randomDecorationFlip is set", () => {
  const map = parseTfmMap('<C><P L="800" H="400"/><Z><S/><D><P T="5" X="100" Y="100" P="0,2"/></D><O/></Z></C>');
  const resolver = { resolve: ({ source }) => (source === "$P_5" ? { href: "data:image/svg+xml;base64,AAAA", width: 10, height: 10, origin: { x: 5, y: 5 } } : null) };
  assert.doesNotMatch(renderTfmSvg(map, { assetResolver: resolver }), /scale\(-1 1\)/);
  let flipped = 0;
  for (let seed = 0; seed < 20; seed++) if (/scale\(-1 1\)/.test(renderTfmSvg(map, { assetResolver: resolver, randomDecorationFlip: true, textureSeed: seed }))) flipped++;
  assert.ok(flipped > 0 && flipped < 20);
});
