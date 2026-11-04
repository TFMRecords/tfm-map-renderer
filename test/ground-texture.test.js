import test from "node:test";
import assert from "node:assert/strict";
import { createTextureContext, renderTexturedGround, textureDefs as textureDefNodes, seededRandom } from "../src/render/ground-texture.js";
import { sceneToSvg } from "../src/render/scene.js";
import { parseTfmMap } from "../src/index.js";
import { renderTfmSvg } from "../src/render/svg.js";

// Every symbol resolves to a distinct data URI so the tile choice can be read back from the output.
const resolver = {
  resolve: ({ key }) => ({ key, href: `data:image/svg+xml;utf8,${encodeURIComponent(key)}`, width: key.startsWith("$T_") ? 40 : 100, height: key.startsWith("$T_") ? 40 : 100, origin: { x: 0, y: 0 } }),
};
const uses = (svg) => (svg.match(/<use /g) ?? []).length;
// The texture as SVG text: { base, strip } of renderTexturedGround are scene nodes (src/render/scene.js).
const asSvg = (out) => out && { base: sceneToSvg(out.base), strip: sceneToSvg(out.strip) };
const textureDefs = (ctx) => sceneToSvg(textureDefNodes(ctx));
const render = (g) => asSvg(renderTexturedGround(createTextureContext(resolver, 7), { dynamic: false, tint: 0x808080, ...g }));

test("a plain tiled ground (type 5) gets one tile per 40x40 cell", () => {
  const { base } = render({ type: 5, width: 120, height: 80 });
  assert.equal(uses(base), 3 * 2);
  assert.doesNotMatch(base, /filter=/);
});

test("types with an edge: a width that is a multiple of 40 gets corners and side columns, otherwise only a top row", () => {
  const framed = render({ type: 6, width: 120, height: 80 }).base; // grass: 3 columns, 2 rows
  assert.equal(uses(framed), 3 * 2 + 3 + 2 * 1); // fill + top row (1 middle + 2 corners) + left and right column below
  const open = render({ type: 6, width: 100, height: 80 }).base;
  assert.equal(uses(open), 3 * 2 + 3); // fill + one top-row piece per column
});

test("galaxy (21) draws its first row into a separate strip above the mice and fills from row 1", () => {
  const out = render({ type: 21, width: 120, height: 80 });
  assert.equal(uses(out.strip), 3);
  assert.equal(uses(out.base), 3 * 1 + 3); // fill rows 1.. plus the row under the strip
});

test("pre-rendered bitmaps for dynamic grounds, the vector clip for static ones, and the overlay only on static tiled grounds", () => {
  const dynamicGround = render({ type: 0, width: 200, height: 100, dynamic: true }).base;
  const staticGround = render({ type: 0, width: 200, height: 100, dynamic: false }).base;
  assert.match(dynamicGround, /scale\(0\.5 0\.25\)/); // 400x400 bitmap stretched to 200x100
  assert.doesNotMatch(staticGround, /scale\(/);
  assert.match(render({ type: 0, width: 10, height: 10, dynamic: true }).base, /scale\(0\.1 0\.1\)/); // under 20: the 100x100 bitmap
  assert.match(render({ type: 5, width: 80, height: 80 }).base, /mix-blend-mode:overlay/);
  assert.doesNotMatch(render({ type: 5, width: 80, height: 80, dynamic: true }).base, /mix-blend-mode/);
  assert.doesNotMatch(render({ type: 5, width: 80, height: 80, pregeneratedForced: true }).base, /mix-blend-mode/);
});

test("a tint becomes a colour-matrix filter, the neutral tint none, and undefined types fall back to $Sol_Dur", () => {
  const ctx = createTextureContext(resolver, 1);
  const tinted = asSvg(renderTexturedGround(ctx, { type: 5, width: 40, height: 40, dynamic: false, tint: 0xff4080 }));
  assert.match(tinted.base, /filter="url\(#tint-ff4080\)"/);
  assert.match(textureDefs(ctx), /<feColorMatrix[^>]*values="1.9922 0 0 0 0  0 0.5 0 0 0  0 0 1 0 0  0 0 0 1 0"/);
  assert.match(render({ type: 22, width: 40, height: 40 }).base, /Sol_Dur/);
});

test("a missing asset makes the whole ground fall back to the placeholder", () => {
  const empty = createTextureContext({ resolve: () => null }, 1);
  assert.equal(renderTexturedGround(empty, { type: 5, width: 80, height: 80, dynamic: false, tint: 0x808080 }), null);
});

test("renderTfmSvg uses the textures with a resolver, emits each tile once, and `textures: false` restores the placeholders", () => {
  const map = parseTfmMap('<C><P L="800" H="400"/><Z><S><S T="5" X="100" Y="100" L="400" H="200" P="0,0,0.3,0.2,0,0,0,0"/></S><D/><O/></Z></C>');
  const svg = renderTfmSvg(map, { assetResolver: resolver });
  assert.equal((svg.match(/<symbol /g) ?? []).length, 2); // type 5 uses two distinct tiles, each defined once
  assert.ok(uses(svg) >= 10 * 5);
  assert.doesNotMatch(renderTfmSvg(map, { assetResolver: resolver, textures: false }), /<symbol /);
  assert.doesNotMatch(renderTfmSvg(map), /<symbol /);
});

test("the random source is deterministic", () => {
  const a = seededRandom(5);
  const b = seededRandom(5);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("foreground grounds (9, 15, 21 and N) are drawn above the objects and the galaxy strip behind its ground", () => {
  const map = parseTfmMap('<C><P L="800" H="400"/><Z><S><S T="0" X="50" Y="50" L="40" H="40" P="0,0,0.3,0.2,0,0,0,0"/><S T="21" X="150" Y="50" L="80" H="40" P="0,0,0.3,0.2,0,0,0,0"/><S T="15" X="250" Y="50" L="40" H="40"/></S><D/><O><O C="1" X="5" Y="5"/></O></Z></C>');
  const objectResolver = { resolve: (ref) => resolver.resolve({ key: ref.key ?? ref.source }) };
  const svg = renderTfmSvg(map, { assetResolver: objectResolver, resolveObjectAsset: () => "$Objet_1" });
  const at = (re) => svg.search(re);
  assert.ok(at(/data-type="0"/) < at(/%24Objet_1/) || at(/%24Objet_1/) === -1); // a normal ground is below the objects
  const object = at(/%24Objet_1/);
  assert.ok(object > -1);
  assert.ok(svg.lastIndexOf('data-type="21"') > object); // the galaxy ground itself is above the objects
  assert.ok(at(/data-type="15"/) > object); // cobweb above the objects
  // the strip (a second data-type="21" group) comes before the objects, i.e. in the normal ground layer
  assert.ok(svg.indexOf('data-type="21"') < object);
});

test("interior fill tiles are backed by their first fill colour, edge tiles are not", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><path d="M0 0h40v40H0z" fill="#a32300"/></svg>`;
  const href = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const ctx = createTextureContext({ resolve: () => ({ href, width: 40, height: 40, origin: { x: 0, y: 0 } }) });
  assert.ok(renderTexturedGround(ctx, { type: 18, width: 80, height: 80, dynamic: false }));
  const defs = textureDefs(ctx);
  assert.match(defs, /<symbol id="tile-4-opaque"[^>]*><rect[^>]*fill="#a32300"\/>/);
  assert.match(defs, /<symbol id="tile-38"[^>]*><image/);
});

test("a translucent fill tile (the cobweb) gets no backdrop", async () => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><path d="M0 0h40" fill="#ffffff"/></svg>`;
  const href = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  const ctx = createTextureContext({ resolve: () => ({ href, width: 40, height: 40, origin: { x: 0, y: 0 } }) });
  assert.ok(renderTexturedGround(ctx, { type: 15, width: 80, height: 80, dynamic: false }));
  assert.doesNotMatch(textureDefs(ctx), /<rect width="40"/);
});
