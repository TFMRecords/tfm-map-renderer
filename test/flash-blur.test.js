import test from "node:test";
import assert from "node:assert/strict";
import { flashBlurChains, flashBlurPrimitives } from "../src/util/flash-blur.js";
import { parseTfmMap } from "../src/index.js";
import { renderTfmSvg } from "../src/render/svg.js";

test("a box blur of width 5, three passes, both directions is six feConvolveMatrix primitives", () => {
  const out = flashBlurPrimitives(5, 5, 3, "SourceAlpha", "b", "p");
  assert.equal((out.match(/<feConvolveMatrix/g) ?? []).length, 6);
  assert.match(out, /in="SourceAlpha" result="p0" order="5 1" kernelMatrix="1 1 1 1 1" divisor="5" targetX="2" targetY="0"/);
  assert.match(out, /result="b" order="1 5"/);
  assert.equal(flashBlurPrimitives(1, 1, 3, "x", "y", "p"), '<feOffset in="x" dx="0" dy="0" result="y"/>');
});

test("FFDec's chain of three Gaussians (sigma = sqrt((w^2 - 1) / 12) each) becomes box blurs of width w", () => {
  const sigma = Math.sqrt((13 * 13 - 1) / 12);
  const chain = `<feGaussianBlur in="a" result="r1" stdDeviation="${sigma} ${sigma}"/><feGaussianBlur in="r1" result="r2" stdDeviation="${sigma} ${sigma}"/><feGaussianBlur in="r2" result="r3" stdDeviation="${sigma} ${sigma}"/>`;
  const out = flashBlurChains(`<filter>${chain}<feComposite in="a" in2="r3"/></filter>`);
  assert.equal((out.match(/<feConvolveMatrix/g) ?? []).length, 6);
  assert.match(out, /order="13 1"/);
  assert.match(out, /in="a"/);
  assert.match(out, /result="r3"[^>]*\/><feComposite in="a" in2="r3"\/>/);
  assert.ok(!out.includes("feGaussianBlur"));
});

test("chains that are not a Flash blur are left alone", () => {
  const odd = `<feGaussianBlur in="a" result="r1" stdDeviation="2.5 2.5"/><feGaussianBlur in="r1" result="r2" stdDeviation="2.5 2.5"/>`;
  assert.equal(flashBlurChains(odd), odd);
  const single = `<feGaussianBlur in="a" result="r1" stdDeviation="3.7416573867739413 3.7416573867739413"/>`;
  assert.equal(flashBlurChains(single), single);
});

test("the hole glow uses the box blurs unless flashBlur is false", () => {
  const map = parseTfmMap('<C><P L="800" H="400"/><Z><S/><D><T X="100" Y="100" CT="1"/></D><O/></Z></C>');
  const resolver = { resolve: ({ key }) => (key === "$Trou_Souris" ? { href: "data:image/svg+xml;utf8,x", width: 10, height: 10, origin: { x: 5, y: 5 } } : null) };
  assert.match(renderTfmSvg(map, { assetResolver: resolver, textures: false }), /id="hole-glow-1"[^]*feConvolveMatrix/);
  const gaussian = renderTfmSvg(map, { assetResolver: resolver, textures: false, flashBlur: false });
  assert.match(gaussian, /feGaussianBlur in="SourceAlpha" stdDeviation="2.5"/);
  assert.ok(!gaussian.includes("feConvolveMatrix"));
});
