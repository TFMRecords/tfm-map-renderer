import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmMap } from "../src/index.js";
import { renderTfmSvg } from "../src/render/svg.js";

const resolver = { resolve: ({ source }) => ({ href: `data:image/png;base64,${Buffer.from(String(source)).toString("base64")}`, width: 10, height: 10 }) };
const xml = '<C><P L="800" H="400" D="a.png,0,0,1,30" d="b.png,0,0" APS="c.png,0,0,0,10,10,0,0" ARPS="e.png,0,0,0,10,10,0,0" IP="f.png,0,0"/><Z><S><S T="0" X="100" Y="100" L="50" H="20" P="0,0,0.3,0.2,0,0,0,0" i="0,0,g.png"/></S><D/><O/></Z></C>';
const images = (svg) => (svg.match(/<image/g) ?? []).length;

test("restricted mode drops ground i, APS, ARPS, IP and D/d repeat clones; the default draws what the XML says", () => {
  const map = parseTfmMap(xml);
  const full = renderTfmSvg(map, { assetResolver: resolver, textures: false });
  const restricted = renderTfmSvg(map, { assetResolver: resolver, textures: false, clientLimits: "restricted" });
  assert.ok(images(full) > images(restricted));
  assert.equal(images(restricted), 2); // D and d, once each, without repeats; no APS, ARPS, IP or ground image
  assert.equal(images(full), 2 + 1 + 1 + 1); // D and its clone, d, APS and the ground image (ARPS and IP are shown later by events)
  assert.doesNotMatch(restricted, new RegExp(Buffer.from("g.png").toString("base64")));
  assert.match(full, new RegExp(Buffer.from("g.png").toString("base64")));
});
