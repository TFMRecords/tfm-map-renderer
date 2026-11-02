import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFfdecSvg, standaloneSvg, parseStandaloneSvg, parseMatrix } from "../src/assets/svg-normalize.js";
import { parseXml } from "../src/xml/parse.js";

// Byte-for-byte shapes of real FFDec 26.3.0 output captured from the synthetic SWF fixture.
const SHAPE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns:ffdec="https://www.free-decompiler.com/flash" xmlns:xlink="http://www.w3.org/1999/xlink" ffdec:objectType="shape" height="40.0px" width="20.0px" xmlns="http://www.w3.org/2000/svg">
  <g transform="matrix(1.0, 0.0, 0.0, 1.0, 10.0, 20.0)">
    <path d="M-10.0 -20.0 L10.0 -20.0 10.0 20.0 -10.0 20.0 -10.0 -20.0" fill="#ff0000" fill-rule="evenodd" stroke="none"/>
  </g>
</svg>
`;
const SPRITE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<svg xmlns:ffdec="https://www.free-decompiler.com/flash" xmlns:xlink="http://www.w3.org/1999/xlink" ffdec:objectType="frame" height="40.0px" width="55.0px" xmlns="http://www.w3.org/2000/svg">
  <g transform="matrix(1.0, 0.0, 0.0, 1.0, 5.0, 20.0)">
    <use ffdec:characterId="1" ffdec:characterName="Marker" height="40.0" transform="matrix(1.0, 0.0, 0.0, 1.0, 5.0, 0.0)" width="20.0" xlink:href="#shape0"/>
    <use ffdec:characterId="2" height="10.0" transform="matrix(1.0, 0.0, 0.0, 1.0, 0.0, 0.0)" width="50.0" xlink:href="#shape1"/>
  </g>
  <defs>
    <g id="shape0">
      <path d="M-10.0 -20.0 L10.0 -20.0 10.0 20.0 -10.0 20.0 -10.0 -20.0" fill="#ff0000" fill-rule="evenodd" stroke="none"/>
    </g>
    <g id="shape1">
      <path d="M0.0 0.0 L50.0 0.0 50.0 10.0 0.0 10.0 0.0 0.0" fill="#008000" fill-rule="evenodd" stroke="none"/>
    </g>
  </defs>
</svg>
`;

test("recovers registration origin and size from the root bounds-shift group", () => {
  const n = normalizeFfdecSvg(SHAPE, { idPrefix: "a1_" });
  assert.deepEqual([n.width, n.height], [20, 40]);
  assert.deepEqual(n.origin, { x: 10, y: 20 });
  assert.deepEqual(n.bounds, { x: -10, y: -20, width: 20, height: 40 });
  assert.deepEqual(n.diagnostics, []);
  // content stays in Flash coordinates, so the path is unchanged and the wrapper group is gone
  assert.match(n.body, /^<path d="M-10\.0 -20\.0/);
  assert.doesNotMatch(n.body, /<g /);
});

test("strips ffdec attributes/namespaces and namespaces ids and references", () => {
  const n = normalizeFfdecSvg(SPRITE, { idPrefix: "a3_" });
  assert.deepEqual(n.origin, { x: 5, y: 20 });
  assert.doesNotMatch(n.body + n.defs, /ffdec/);
  assert.match(n.body, /xlink:href="#a3_shape0"/);
  assert.match(n.body, /xlink:href="#a3_shape1"/);
  assert.match(n.defs, /<g id="a3_shape0">/);
  assert.equal(n.usesXlink, true);
});

test("standalone SVG is well-formed XML with a viewBox that preserves the registration point", () => {
  const n = normalizeFfdecSvg(SPRITE, { idPrefix: "a3_" });
  const svg = standaloneSvg(n);
  const doc = parseXml(svg);
  assert.equal(doc.diagnostics.length, 0);
  assert.equal(doc.root.attributes.find((a) => a.name === "viewBox").value, "-5 -20 55 40");
  const back = parseStandaloneSvg(svg);
  assert.deepEqual(back.origin, { x: 5, y: 20 });
  assert.equal(back.body, n.body);
  assert.equal(back.defs, n.defs);
});

test("url(#id) references inside attributes are rewritten", () => {
  const src = `<svg width="1px" height="1px" xmlns="http://www.w3.org/2000/svg"><g transform="matrix(1,0,0,1,0,0)"><rect fill="url(#grad)" clip-path="url( #c )"/></g><defs><linearGradient id="grad"/><clipPath id="c"/></defs></svg>`;
  const n = normalizeFfdecSvg(src, { idPrefix: "z_" });
  assert.match(n.body, /fill="url\(#z_grad\)"/);
  assert.match(n.body, /clip-path="url\(#z_c\)"/);
  assert.match(n.defs, /id="z_grad"/);
});

test("reports instead of guessing when the root group is not a pure translation", () => {
  const src = `<svg width="2px" height="2px" xmlns="http://www.w3.org/2000/svg"><g transform="matrix(2,0,0,2,1,1)"><rect/></g></svg>`;
  const n = normalizeFfdecSvg(src, { idPrefix: "q_" });
  assert.deepEqual(n.diagnostics, ["root-group-non-identity-linear-part"]);
  assert.deepEqual(n.origin, { x: 0, y: 0 });
  assert.match(n.body, /^<g transform="matrix\(2,0,0,2,1,1\)">/);
});

test("rejects non-svg input and missing sizes; attribute text is escaped", () => {
  assert.throws(() => normalizeFfdecSvg("<html/>", { idPrefix: "a_" }), /expected <svg>/);
  assert.throws(() => normalizeFfdecSvg('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>', { idPrefix: "a_" }), /width\/height/);
  const n = normalizeFfdecSvg(`<svg width="1px" height="1px"><g transform="matrix(1,0,0,1,0,0)"><text data-x="a &amp; &quot;b&quot;">1 &lt; 2</text></g></svg>`, { idPrefix: "a_" });
  assert.equal(n.body, '<text data-x="a &amp; &quot;b&quot;">1 &lt; 2</text>');
});

test("parseMatrix accepts FFDec spacing and rejects non-matrix transforms", () => {
  assert.deepEqual(parseMatrix("matrix(1.0, 0.0, 0.0, 1.0, 10.0, 20.0)"), { a: 1, b: 0, c: 0, d: 1, e: 10, f: 20 });
  assert.equal(parseMatrix("translate(1 2)"), null);
  assert.equal(parseMatrix(undefined), null);
});
