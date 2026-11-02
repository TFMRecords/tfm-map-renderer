import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmMap } from "../src/index.js";
import { renderTfmSvg } from "../src/render/svg.js";

const map = parseTfmMap('<C><P L="800" H="400" ARPS="a.png,0,100,50,30,30,90,40" IP="b.png,200,60" APS="c.png,0,300,50,30,30,290,40"/><Z><S/><D/><O/></Z></C>');
const seen = [];
const resolver = { resolve: ({ source, layer }) => { seen.push(`${source}:${layer ?? ""}`); return { href: "data:image/svg+xml;utf8,x", width: 10, height: 10 }; } };

test("ARPS and IP images are not drawn by default (the game shows them only on a trigger)", () => {
  seen.length = 0;
  renderTfmSvg(map, { assetResolver: resolver });
  assert.deepEqual(seen.filter((s) => !s.startsWith("c.png")), []);
});

test("renderAppearingImages and renderPortalImages draw them in the bottom layer; ARPS needs the arps feature, IP an unrestricted map", () => {
  seen.length = 0;
  const svg = renderTfmSvg(map, { assetResolver: resolver, renderAppearingImages: true, renderIpImages: true });
  assert.ok(seen.includes("a.png:arps") && seen.includes("b.png:"));
  assert.match(svg, /<image[^>]*x="90" y="40"/);
  assert.match(svg, /<image[^>]*x="200" y="60"/);
  seen.length = 0;
  renderTfmSvg(map, { assetResolver: resolver, renderAppearingImages: true, renderIpImages: true, clientLimits: "restricted" });
  assert.ok(!seen.some((s) => s.startsWith("a.png") || s.startsWith("b.png")), "restricted: neither");
  seen.length = 0;
  renderTfmSvg(map, { assetResolver: resolver, renderAppearingImages: true, renderIpImages: true, clientLimits: "module" });
  assert.ok(!seen.some((s) => s.startsWith("a.png")) && seen.some((s) => s.startsWith("b.png")), "module: IP yes, ARPS no (it needs param4)");
});
