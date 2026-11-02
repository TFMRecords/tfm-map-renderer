import test from "node:test";
import assert from "node:assert/strict";
import * as b from "../test-support/swf-builder.js";
import { readSpritePlacements } from "../src/swf/display-list.js";
import { applyClipEffects, compactPlacements } from "../src/assets/clip-effects.js";
import { buildEffects } from "../src/assets/release.js";

/** Bit string -> bytes. */
function bits(str) {
  const padded = str.padEnd(Math.ceil(str.length / 8) * 8, "0");
  return Buffer.from(padded.match(/.{8}/g).map((x) => parseInt(x, 2)));
}
const signed = (v, n) => (v < 0 ? v + 2 ** n : v).toString(2).padStart(n, "0");

/** PlaceObject3 with a translation-free matrix, a colour transform and a blend mode. */
function placeObject3(depth, characterId, { mul, add, blend }) {
  const n = 10;
  const cx = `${add ? 1 : 0}${mul ? 1 : 0}${n.toString(2).padStart(4, "0")}`
    + (mul ? mul.map((v) => signed(Math.round(v * 256), n)).join("") : "")
    + (add ? add.map((v) => signed(v, n)).join("") : "");
  const flags = 0x02 | 0x04 | (mul || add ? 0x08 : 0);
  const flags2 = blend ? 0x02 : 0;
  const u16 = (v) => Buffer.from([v & 255, v >> 8]);
  return b.tag(70, Buffer.concat([Buffer.from([flags, flags2]), u16(depth), u16(characterId), bits("0000000"), ...(mul || add ? [bits(cx)] : []), ...(blend ? [Buffer.from([blend])] : [])]));
}

function sample() {
  return b.buildSwf([
    b.defineShapeRect(1, 0, 0, 400, 400),
    b.defineShapeRect(2, 0, 0, 100, 100),
    b.defineSprite(3, [b.placeObject2(1, 1), placeObject3(2, 2, { mul: [1, 0.5, 0.25, 0.5], add: [129, 0, 0, 0], blend: 8 })]),
    b.defineSprite(4, [b.placeObject2(1, 1)]),
    b.symbolClass([[3, "$T_x"], [4, "$Plain"]]),
  ]);
}

test("reads colour transform and blend mode of the instances of a sprite, in depth order", () => {
  const found = readSpritePlacements(sample(), ["$T_x", "$Plain", "$Missing"]);
  assert.equal(found.has("$Missing"), false);
  const [shape, glow] = found.get("$T_x");
  assert.deepEqual([shape.depth, shape.characterId, shape.colorTransform, shape.blend], [1, 1, null, null]);
  assert.deepEqual([glow.depth, glow.characterId, glow.blend], [2, 2, 8]);
  assert.deepEqual(glow.colorTransform, { mul: [1, 0.5, 0.25, 0.5], add: [129, 0, 0, 0] });
  assert.deepEqual(compactPlacements(found), { $T_x: [{ cx: null, blend: null }, { cx: glow.colorTransform, blend: 8 }] });
});

const GRADIENT = (id) => `<g id="${id}"><path fill="url(#g)" d="M0 0"/></g>`;
const vector = { defs: GRADIENT("a_sprite0"), body: '<use width="40" xlink:href="#a_shape0"/><use width="10" xlink:href="#a_sprite0"/>' };
const placements = [{ cx: null, blend: null }, { cx: { mul: [1, 0.5, 0.25, 0.5], add: [129, 0, 0, 0] }, blend: 8 }];

test("applyClipEffects puts the colour transform and the add blend back on the matching instance", () => {
  const { defs, body } = applyClipEffects(vector, placements);
  assert.match(defs, /<g id="a_sprite0">.*<filter id="fxcx0"[^>]*><feColorMatrix type="matrix" values="1 0 0 0 0\.50588  0 0\.5 0 0 0  0 0 0\.25 0 0  0 0 0 0\.5 0"\/><\/filter>/);
  assert.match(body, /^<use width="40" xlink:href="#a_shape0"\/><use style="mix-blend-mode: plus-lighter" filter="url\(#fxcx0\)" width="10"/);
});

test("with gradients: false only the placements that carry a blend mode get their transform back", () => {
  const noBlend = [{ cx: { mul: [1, 0.5, 0.25, 1], add: [0, 0, 0, 0] }, blend: null }, { cx: { mul: [0.5, 0.5, 0.5, 1], add: [0, 0, 0, 0] }, blend: null }];
  assert.equal(applyClipEffects(vector, noBlend, { gradients: false }).body, vector.body);
  assert.match(applyClipEffects(vector, noBlend).body, /filter="url\(#fxcx0\)"/);
  assert.match(applyClipEffects(vector, placements, { gradients: false }).body, /filter="url\(#fxcx0\)"/);
});

test("applyClipEffects combines with an existing filter, keeps an existing blend and ignores mismatched lists", () => {
  const blurred = { defs: GRADIENT("a"), body: '<use filter="url(#blur)" style="mix-blend-mode: overlay" xlink:href="#a"/>' };
  const out = applyClipEffects(blurred, [{ cx: { mul: [1, 1, 1, 0.5], add: [0, 0, 0, 0] }, blend: 13 }]);
  assert.match(out.body, /filter="url\(#blur\) url\(#fxcx0\)"/);
  assert.equal((out.body.match(/mix-blend-mode/g) ?? []).length, 1);
  assert.equal(applyClipEffects(vector, [placements[1]]), vector);
  assert.equal(applyClipEffects(vector, undefined), vector);
  assert.equal(applyClipEffects(vector, [{ cx: null, blend: null }, { cx: null, blend: null }]), vector);
});

test("buildEffects lists only the sprites that need it, per release source", () => {
  const effects = buildEffects([{ name: "x", swf: "a.swf" }], new Map([["a.swf", sample()]]));
  assert.deepEqual(Object.keys(effects.x), ["$T_x"]);
});

test("skinned clips are coloured from the Couleur<n>_<hex> instance names", async () => {
  const { colourFromName } = await import("../src/assets/clip-effects.js");
  assert.deepEqual(colourFromName("Couleur1_808080"), { mul: [1, 1, 1, 1], add: [0, 0, 0, 0] });
  assert.deepEqual(colourFromName("Couleur0_FF4000"), { mul: [255 / 128, 0.5, 0, 1], add: [0, 0, 0, 0] });
  assert.equal(colourFromName("Tete_1"), null);
  // The instance name may hold any number of hex digits: a 7-digit typo from the real game data (`$Objet_2823`) wraps through the channel masks; a missing part is black
  assert.deepEqual(colourFromName("Couleur1_EF08D2A").mul, [0xf0 / 128, 0x8d / 128, 0x2a / 128, 1]);
  assert.deepEqual(colourFromName("Couleur1").mul, [0, 0, 0, 1]);
  assert.deepEqual(colourFromName("Couleur2_zz").mul, [0, 0, 0, 1]);
  assert.equal(colourFromName(null), null);
  const placements = new Map([["$Objet_1002", [{ depth: 1, colorTransform: null, blend: null, name: "Couleur0_C0C0C0" }, { depth: 2, colorTransform: null, blend: null, name: null }]]]);
  const rows = compactPlacements(placements, { nameColours: true });
  assert.deepEqual(rows.$Objet_1002[0].cx.mul, [1.5, 1.5, 1.5, 1]);
  assert.equal(rows.$Objet_1002[1].cx, null);
  // decorations (spec: D/P.C): the name only says which colour of the `C` list paints the part, there is no default colour
  const plain = compactPlacements(placements);
  assert.equal(plain.$Objet_1002[0].cx, null);
  assert.equal(plain.$Objet_1002[0].name, "Couleur0_C0C0C0");
  assert.equal(plain.$Objet_1002[1].name, undefined);
});

test("applyClipEffects paints the Couleur<n> instances with the colours of a decoration's C list", () => {
  const body = '<use xlink:href="#a_shape0"/><use xlink:href="#a_sprite0"/><use xlink:href="#a_sprite1"/>';
  const placements = [{ cx: null, blend: null }, { cx: null, blend: null, name: "Couleur0_FFFFFF" }, { cx: null, blend: null, name: "Couleur2_FFFFFF" }];
  assert.deepEqual(applyClipEffects({ defs: "", body }, placements), { defs: "", body }, "no colours: nothing changes");
  const out = applyClipEffects({ defs: "", body }, placements, { colors: ["FF8000", "000000"] });
  assert.match(out.defs, /<filter id="fxcx0"[^>]*><feColorMatrix type="matrix" values="1\.99219 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0"\/>/);
  assert.match(out.defs, /<filter id="fxcx1"[^>]*><feColorMatrix type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0"\/>/, "a missing colour entry is black");
  assert.equal((out.body.match(/filter=/g) ?? []).length, 2);
});

test("effects of nested sprites are applied inside the matching <g id=...sprite<n>> of the defs, and the SWF numbering of FFDec's sprite ids is followed", async () => {
  const b = await import("../test-support/swf-builder.js");
  const { readSpriteTrees } = await import("../src/swf/display-list.js");
  // root sprite 5 places sprite 4 (first sprite used -> sprite0) which places shape 1 with a transform and blend (no, a sprite 3: sprite1)
  const swf = b.buildSwf([
    b.defineShapeRect(1, 0, 0, 100, 100),
    b.defineSprite(3, [b.placeObject2(1, 1)]),
    b.defineSprite(4, [b.placeObject2(1, 1), b.placeObject2(2, 3)]),
    b.defineSprite(5, [b.placeObject2(1, 4)]),
    b.symbolClass([[5, "$Root"]]),
  ]);
  const tree = readSpriteTrees(swf, ["$Root"]).get("$Root");
  assert.deepEqual(Object.keys(tree.nested), ["sprite0", "sprite1"]);
  assert.deepEqual(tree.nested.sprite0.map((p) => p.characterId), [1, 3]);
  assert.deepEqual(tree.nested.sprite1.map((p) => p.characterId), [1]);
  const vector = { defs: '<g id="a_sprite0"><use xlink:href="#a_shape0"/><use xlink:href="#a_sprite1"/></g><g id="a_sprite1"><use xlink:href="#a_shape0"/></g><g id="a_shape0"><path fill="url(#g)" d="M0 0"/></g>', body: '<use xlink:href="#a_sprite0"/>' };
  const rows = { top: [{ cx: null, blend: null }], nested: { sprite0: [{ cx: null, blend: null }, { cx: { mul: [1, 1, 1, 0.5], add: [0, 0, 0, 0] }, blend: 8 }] } };
  const out = applyClipEffects(vector, rows);
  assert.match(out.defs, /<g id="a_sprite0"><use xlink:href="#a_shape0"\/><use style="mix-blend-mode: plus-lighter" filter="url\(#fxcx0\)" xlink:href="#a_sprite1"\/><\/g>/);
  assert.match(out.defs, /<g id="a_sprite1"><use xlink:href="#a_shape0"\/><\/g>/);
  assert.equal(out.body, vector.body);
  // a colour transform on a group of solid fills is not applied again: FFDec already baked it into the fills
  const solid = { defs: '<g id="a_sprite0"><path fill="#ff0000" d="M0 0"/></g>', body: '<use xlink:href="#a_sprite0"/>' };
  assert.deepEqual(applyClipEffects(solid, [{ cx: { mul: [0.5, 0.5, 0.5, 1], add: [0, 0, 0, 0] }, blend: null }]), solid);
  const compact = compactPlacements(new Map([["$Root", tree]]));
  assert.deepEqual(compact, {}, "nothing in the tree is transformed");
});

test("a default colour taken from the instance name is applied to SOLID fills too (FFDec never baked it: it is not a transform in the SWF)", async () => {
  const { compactPlacements } = await import("../src/assets/clip-effects.js");
  const placements = new Map([["$Objet_101", [{ depth: 1, colorTransform: null, blend: null, name: "Couleur2_F3899F" }, { depth: 2, colorTransform: { mul: [2, 1, 1, 1], add: [0, 0, 0, 0] }, blend: null, name: null }]]]);
  const rows = compactPlacements(placements, { nameColours: true }).$Objet_101;
  assert.equal(rows[0].nm, true);
  assert.equal(rows[1].nm, undefined, "a real SWF transform is not name-derived");
  const defs = '<g id="a_sprite0"><path d="M0 0" fill="#808080"/></g>';
  const out = applyClipEffects({ defs, body: '<use xlink:href="#a_sprite0"/>' }, [rows[0]]);
  assert.match(out.defs, /<feColorMatrix/);
  assert.match(out.body, /filter="url\(#fxcx0\)"/);
});
