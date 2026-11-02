import test from "node:test";
import assert from "node:assert/strict";
import { parseTfmMap } from "../src/index.js";
import { renderTfmSvg } from "../src/render/svg.js";
import { applyClientLimits, resolveClientLimits, CLIENT_LIMIT_PRESETS } from "../src/render/client-limits.js";

const many = (tag, n, attrs) => Array.from({ length: n }, (_, i) => `<${tag} ${attrs(i)}/>`).join("");
const xml = (settings = "") => `<C><P L="3000" H="1200"${settings}/><Z><S>${many("S", 70, (i) => `T="0" X="${i}" Y="1" L="10" H="10" P="0,0,0.3,0.2,0,0,0,0"`)}</S><D>${many("P", 55, (i) => `X="${i}" Y="1" T="1" P="0,0"`)}</D><O>${many("O", 45, (i) => `C="1" X="${i}" Y="1"`)}</O></Z></C>`;

test("presets have the client's numbers", () => {
  const r = CLIENT_LIMIT_PRESETS.restricted;
  assert.deepEqual([r.maxWidth, r.maxWidthDefilante, r.maxHeight, r.maxGrounds, r.maxDecorations, r.maxObjects, r.maxObjectIndex], [1600, 4800, 800, 60, 50, 40, 200]);
  assert.equal(r.restricted, true);
  assert.equal(CLIENT_LIMIT_PRESETS.module.arps, false);
  assert.equal(CLIENT_LIMIT_PRESETS.module.restricted, false);
  assert.equal(resolveClientLimits(undefined), CLIENT_LIMIT_PRESETS.unrestricted);
  assert.equal(resolveClientLimits("none"), CLIENT_LIMIT_PRESETS.unrestricted);
});

test("the restricted preset cuts the map like the client and leaves the parsed map alone", () => {
  const map = parseTfmMap(xml());
  const cut = applyClientLimits(map, resolveClientLimits("restricted"));
  assert.equal(cut.settings.width, 1600);
  assert.equal(cut.settings.height, 800);
  assert.equal(cut.grounds.length, 60);
  assert.equal(cut.decorations.length, 50);
  assert.equal(cut.objects.length, 40);
  assert.equal(map.settings.width, 3000);
  assert.equal(map.grounds.length, 70);
});

test("defilante raises the width cap to 4800", () => {
  const map = parseTfmMap(xml(' defilante="0,0,0,0"').replace('L="3000"', 'L="9000"'));
  assert.equal(applyClientLimits(map, resolveClientLimits("restricted")).settings.width, 4800);
});

test("custom limits override a preset and are validated", () => {
  const map = parseTfmMap(xml());
  const custom = resolveClientLimits({ preset: "restricted", maxGrounds: 65, maxWidth: null });
  const cut = applyClientLimits(map, custom);
  assert.equal(cut.grounds.length, 65);
  assert.equal(cut.settings.width, 3000);
  assert.equal(applyClientLimits(map, resolveClientLimits({ maxObjects: 3 })).objects.length, 3);
  assert.throws(() => resolveClientLimits("strict"), /unknown client limits preset/);
  assert.throws(() => resolveClientLimits({ maxGrounds: -1 }), RangeError);
  assert.throws(() => resolveClientLimits({ nope: 1 }), /unknown clientLimits key/);
});

test("defilante marker objects are not counted against the object cap", () => {
  const list = `<O C="6" X="1" Y="1"/><O C="32" X="1" Y="1"/>${many("O", 5, () => 'C="1" X="1" Y="1"')}`;
  const map = parseTfmMap(`<C><P L="800" H="400" defilante="0,0,0,0"/><Z><S/><D/><O>${list}</O></Z></C>`);
  assert.equal(applyClientLimits(map, resolveClientLimits({ maxObjects: 3 })).objects.length, 5); // 2 markers + 3 counted
});

test("renderTfmSvg applies clientLimits; restricted: true is an alias; ARPS follows its own flag", () => {
  const map = parseTfmMap(xml());
  const count = (svg) => (svg.match(/data-type="0"/g) ?? []).length;
  assert.equal(count(renderTfmSvg(map, { limits: false })), 70);
  assert.equal(count(renderTfmSvg(map, { limits: false, clientLimits: "restricted" })), 60);
  assert.equal(count(renderTfmSvg(map, { limits: false, restricted: true })), 60);
  assert.equal(count(renderTfmSvg(map, { limits: false, clientLimits: { maxGrounds: 5 } })), 5);
  const resolver = { resolve: ({ source }) => ({ href: `data:image/png;base64,${Buffer.from(String(source)).toString("base64")}`, width: 10, height: 10 }) };
  const arps = parseTfmMap('<C><P L="800" H="400" ARPS="e.png,0,0,0,10,10,0,0"/><Z><S/><D/><O/></Z></C>');
  const images = (opts) => (renderTfmSvg(arps, { assetResolver: resolver, textures: false, ...opts }).match(/<image/g) ?? []).length;
  // ARPS images appear at run time (they are not in the picture at load time), so none is drawn whatever the limits say.
  assert.equal(images({}), 0);
  assert.equal(images({ clientLimits: "module" }), 0);
  assert.equal(images({ clientLimits: { restricted: true, arps: true } }), 0);
});
