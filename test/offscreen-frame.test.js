import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmMap } from "../src/index.js";
import { renderTfmSvg } from "../src/render/svg.js";

const map = (p) => parseTfmMap(`<C><P L="1200" H="600" ${p}/><Z><S/><D/><O/></Z></C>`);

test("Ca frame is opt-in (renderHideOffscreenFrame) and uses the room colour", () => {
  assert.ok(!renderTfmSvg(map('Ca=""')).includes("evenodd"));
  assert.ok(!renderTfmSvg(map(""), { renderHideOffscreenFrame: true }).includes("evenodd"));
  const svg = renderTfmSvg(map('Ca=""'), { renderHideOffscreenFrame: true });
  assert.match(svg, /<path d="M-2000 -2000h4800v4600h-4800zM0 0v600h800v-600z" fill="#6A7495" fill-rule="evenodd"\/><\/svg>$/i);
  assert.ok(!renderTfmSvg(map('Ca=""'), { renderHideOffscreenFrame: true, backgroundColor: "none" }).includes("evenodd"));
});

test("$P5 heart is opt-in (renderSoulmateHeart) at (12, 30)", () => {
  const resolver = { resolve: ({ source }) => (source === "$P5" ? { href: "data:image/svg+xml;utf8,x", width: 10, height: 10, origin: { x: 2, y: 3 } } : null) };
  const opts = { assetResolver: resolver, textures: false };
  assert.ok(!renderTfmSvg(map('A=""'), opts).includes("translate(12 30)"));
  const svg = renderTfmSvg(map('A=""'), { ...opts, renderSoulmateHeart: true });
  assert.match(svg, /<g transform="translate\(12 30\)"><image[^>]*x="-2" y="-3"/);
  assert.ok(!renderTfmSvg(map(""), { ...opts, renderSoulmateHeart: true }).includes("translate(12 30)"));
});
