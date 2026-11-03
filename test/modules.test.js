// Lua module conventions decoded by the parser (docs/xml/modules.md).
import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmMap } from "../src/index.js";
import { luaNumber } from "../src/tfm/modules/parkour.js";
import { MAP_MODULES } from "../src/tfm/modules/index.js";

const CHAIR = `<P X="700" Y="300" T="19" C="329cd2" P="0,0"/>`;
const parkour = (decorations, objects = "") => parseTfmMap(`<C><P L="1600" H="800"/><Z><S/><D>${decorations}</D><O>${objects}</O></Z></C>`).modules.parkour;

test("every map gets an entry for every module", () => {
  const map = parseTfmMap(`<C><P/><Z><S/><D/><O/></Z></C>`);
  assert.deepEqual(Object.keys(map.modules), MAP_MODULES.map((m) => m.name));
  assert.equal(map.modules.parkour.detected, false);
});

test("parkour: spawn, nails in map order, then the chair 40 px above it", () => {
  const p = parkour(`<DS X="10" Y="20"/>${CHAIR}`, `<O C="22" X="100" Y="110"/><O C="1" X="0" Y="0"/><O C="22" X="200" Y="210"/>`);
  assert.equal(p.detected, true);
  assert.equal(p.valid, true);
  assert.deepEqual(p.checkpoints.map((c) => [c.number, c.kind, c.x, c.y]), [[1, "spawn", 10, 20], [2, "nail", 100, 110], [3, "nail", 200, 210], [4, "chair", 700, 260]]);
  assert.deepEqual(p.checkpoints.map((c) => c.objectIndex ?? c.decorationIndex), [0, 0, 2, 1]);
  assert.deepEqual(p.chair, { decorationIndex: 1, x: 700, y: 300, foreground: false });
});

test("parkour: the chair colour must be exactly 329cd2, and only the first chair counts", () => {
  assert.equal(parkour(`<DS X="0" Y="0"/><P X="0" Y="0" T="19" C="329CD2" P="0,0"/>`).detected, false);
  assert.equal(parkour(`<DS X="0" Y="0"/><P X="0" Y="0" T="19" C="329cd2,ffffff" P="0,0"/>`).detected, false);
  assert.equal(parkour(`<DS X="0" Y="0"/><P X="0" Y="0" T="18" C="329cd2" P="0,0"/>`).detected, false);
  const two = parkour(`<DS X="0" Y="0"/>${CHAIR}<P X="9" Y="9" T="19" C="329cd2" P="1,0"/>`);
  assert.equal(two.chair.x, 700);
  assert.equal(parkour(`<DS X="0" Y="0"/><P X="1" Y="1" T="19" C="329cd2" P="1,0"/>`).chair.foreground, true);
});

test("parkour: a checkpoint without size keeps the previous size; the spawn starts at 1 and the chair is 1", () => {
  const p = parkour(`<DS X="0" Y="0" size="0.5"/>${CHAIR}`, `<O C="22" X="1" Y="1"/><O C="22" X="2" Y="2" size="2"/><O C="22" X="3" Y="3" size="x"/>`);
  assert.deepEqual(p.checkpoints.map((c) => c.size), [0.5, 0.5, 2, 2, 1]);
  assert.deepEqual(p.checkpoints.map((c) => c.sizeAttribute), [0.5, null, 2, null, null]);
});

test("parkour: stop is presence, cheese 0 removes and anything else gives", () => {
  const p = parkour(`<DS X="0" Y="0" cheese=""/>${CHAIR}`, `<O C="22" X="1" Y="1" stop="" cheese="0"/><O C="22" X="2" Y="2" stop="0" cheese="0.0"/><O C="22" X="3" Y="3" cheese="yes"/>`);
  assert.deepEqual(p.checkpoints.map((c) => c.stop), [false, true, true, false, false]);
  assert.deepEqual(p.checkpoints.map((c) => c.cheese), ["give", "remove", "remove", "give", null]);
});

test("parkour: only elements named O are nails, and C is read as a Lua number", () => {
  const p = parkour(`<DS X="0" Y="0"/>${CHAIR}`, `<X C="22" X="1" Y="1"/><O C=" 22 " X="2" Y="2"/><O C="0x16" X="3" Y="3"/><O C="2200" X="4" Y="4"/>`);
  assert.deepEqual(p.checkpoints.filter((c) => c.kind === "nail").map((c) => c.x), [2, 3]);
});

test("parkour: problems the module rejects a map for", () => {
  assert.deepEqual(parkour(`<T X="0" Y="0"/>`).problems, ["hole", "no-mouse-spawn", "no-chair", "no-checkpoint"]);
  const noSpawn = parkour(CHAIR, `<O C="22" X="1" Y="1"/>`);
  assert.deepEqual(noSpawn.problems, ["no-mouse-spawn"]);
  assert.equal(noSpawn.checkpoints[0].number, 2, "nails are numbered from 2 even without a spawn");
});

test("luaNumber follows Lua's tonumber for attribute strings", () => {
  for (const [s, n] of [["5", 5], [" 2.5 ", 2.5], ["0x10", 16], ["-0x10", -16], ["1e2", 100], [".5", 0.5], ["5.", 5]]) assert.equal(luaNumber(s), n, s);
  for (const s of ["", " ", "abc", "1,2", "Infinity", "0b11", undefined]) assert.equal(luaNumber(s), null, String(s));
});

// Rendering (docs/api/renderer.md#modules).
const { renderTfmSvg } = await import("../src/index.js");
const PARKOUR_MAP = `<C><P/><Z><S/><D><DS X="50" Y="50" size="0.5"/>${CHAIR}</D><O><O C="22" X="100" Y="100" size="2" cheese=""/><O C="22" X="200" Y="100" stop="" cheese="0"/></O></Z></C>`;
const checkpointsOf = (svg) => [...svg.matchAll(/data-role="parkour-checkpoint" data-number="(\d+)"/g)].map((m) => Number(m[1]));

test("parkour overlay: drawn for a detected map by default, hidden with false", () => {
  const map = parseTfmMap(PARKOUR_MAP);
  assert.deepEqual(checkpointsOf(renderTfmSvg(map)), [1, 2, 3], "the chair checkpoint is the chair itself");
  assert.deepEqual(checkpointsOf(renderTfmSvg(map, { modules: { parkour: false } })), []);
  assert.deepEqual(checkpointsOf(renderTfmSvg(map, { modules: false })), []);
});

test("parkour overlay: a map without the chair is left alone unless forced", () => {
  const map = parseTfmMap(`<C><P/><Z><S/><D><DS X="50" Y="50"/></D><O><O C="22" X="100" Y="100"/></O></Z></C>`);
  const plain = renderTfmSvg(map);
  assert.deepEqual(checkpointsOf(plain), []);
  assert.equal(plain, renderTfmSvg(map, { modules: { parkour: false } }), "auto adds nothing");
  assert.deepEqual(checkpointsOf(renderTfmSvg(map, { modules: { parkour: true } })), [1, 2]);
});

test("parkour overlay: size labels and circles, cheese, uncheese and stop", () => {
  const svg = renderTfmSvg(parseTfmMap(PARKOUR_MAP));
  assert.match(svg, /data-number="2"><circle r="6"[^>]*\/><circle r="31"/, "a nail's mouse, then its circle of 16 x size - 1");
  assert.equal((svg.match(/data-parkour="cheese"/g) ?? []).length, 1);
  assert.equal((svg.match(/data-parkour="uncheese"/g) ?? []).length, 1);
  assert.equal((svg.match(/data-parkour="stop"/g) ?? []).length, 1);
  assert.equal((svg.match(/<filter id="parkour-stop"/g) ?? []).length, 1, "the stop filter is defined once");
});

test("parkour overlay: in a mirrored room each checkpoint is flipped back so its labels read normally", () => {
  const svg = renderTfmSvg(parseTfmMap(PARKOUR_MAP), { mirrorX: true });
  assert.match(svg, /transform="translate\(100 100\) scale\(-1 1\)" data-role="parkour-checkpoint"/);
});

test("the modules option rejects unknown modules and values", () => {
  const map = parseTfmMap(PARKOUR_MAP);
  assert.throws(() => renderTfmSvg(map, { modules: { nope: true } }), /unknown module "nope"/);
  assert.throws(() => renderTfmSvg(map, { modules: { parkour: "yes" } }), /"auto", true or false/);
});

test("parkour overlay: no size circle at the default size", () => {
  const svg = renderTfmSvg(parseTfmMap(`<C><P/><Z><S/><D><DS X="50" Y="50"/>${CHAIR}</D><O><O C="22" X="100" Y="100"/><O C="22" X="200" Y="100" size="1.5"/></O></Z></C>`));
  assert.equal((svg.match(/stroke-dasharray="3 3"/g) ?? []).length, 1, "only the checkpoint of size 1.5");
});
