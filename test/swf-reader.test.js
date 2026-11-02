import test from "node:test";
import assert from "node:assert/strict";
import * as b from "../test-support/swf-builder.js";
import { readSwf, UnsupportedSwfError } from "../src/swf/reader.js";

function sample(opts) {
  const px = new Array(4 * 4 * 4).fill(200);
  return b.buildSwf([
    b.defineShapeRect(1, -200, -400, 400, 800),
    b.defineShapeRect(2, 0, 0, 1000, 200, [0, 128, 0, 255]),
    b.defineSprite(3, [b.placeObject2(1, 1, 100, 0), b.placeObject2(2, 2, 0, 0)], 3),
    b.defineBitsLossless2(4, 4, 4, px),
    b.symbolClass([[3, "tree_a"], [1, "Marker"]]),
    b.exportAssets([[2, "ground_green"]]),
  ], opts);
}

for (const compress of [false, true]) {
  test(`reads characters, bounds, frame counts and symbol names (${compress ? "CWS" : "FWS"})`, () => {
    const swf = readSwf(sample({ compress }));
    assert.equal(swf.version, 10);
    assert.equal(swf.compression, compress ? "zlib" : "none");
    assert.deepEqual(swf.frameSize, { x: 0, y: 0, width: 400, height: 200 });
    assert.equal(swf.frameRate, 24);
    assert.equal(swf.characters.size, 4);
    assert.deepEqual(swf.characters.get(1), { id: 1, kind: "shape", tag: "DefineShape3", bounds: { x: -10, y: -20, width: 20, height: 40 }, names: ["Marker"] });
    assert.deepEqual(swf.characters.get(2).bounds, { x: 0, y: 0, width: 50, height: 10 });
    assert.equal(swf.characters.get(2).names[0], "ground_green");
    assert.equal(swf.characters.get(3).kind, "sprite");
    assert.equal(swf.characters.get(3).frameCount, 3);
    assert.deepEqual(swf.characters.get(4), { id: 4, kind: "image", tag: "DefineBitsLossless2", format: 5, width: 4, height: 4 });
    assert.deepEqual(swf.symbols.map((s) => [s.id, s.name, s.source]), [[3, "tree_a", "SymbolClass"], [1, "Marker", "SymbolClass"], [2, "ground_green", "ExportAssets"]]);
    assert.equal(swf.tagCounts.DefineShape3, 2);
  });
}

test("rejects non-SWF input and explains LZMA SWFs", () => {
  assert.throws(() => readSwf(Buffer.from("PNG\x00\x00\x00\x00\x00junk")), UnsupportedSwfError);
  const zws = Buffer.concat([Buffer.from("ZWS"), Buffer.from([13, 0, 0, 0, 0]), Buffer.alloc(8)]);
  assert.throws(() => readSwf(zws), /LZMA/);
});

test("long tags (>= 63 bytes) use the extended header", () => {
  const big = b.defineBitsLossless2(9, 16, 16, new Array(16 * 16 * 4).fill(7));
  const swf = readSwf(b.buildSwf([big, b.defineShapeRect(1, 0, 0, 20, 20)]));
  assert.equal(swf.characters.get(9).width, 16);
  assert.equal(swf.characters.get(1).kind, "shape");
});
