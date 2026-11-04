// Textured grounds, as the game draws them (docs/rendering.md#grounds and ground-textures.js).
//
// Everything is drawn in the ground's content coordinates: the top left corner of the ground is (0, 0) and the caller
// places that corner at (-floor(width / 2), -trunc(height / 2)) like the game does. Tiles are `$T_n` clips copied as
// 40x40 cells; assets come from the resolver by symbol name, and a missing asset makes the whole ground fall back
// (the function returns null) so the caller can draw its placeholder instead. The output is scene nodes (scene.js).

import { defs as defsNode, group } from "./scene.js";
import { DEFAULT_GROUND_SYMBOL, GROUND_TEXTURE_RECIPES, PREGENERATED_SYMBOLS, TILE_SIZE, isPregenerated, tileSymbol } from "./ground-textures.js";

const num = (v) => (Number.isInteger(v) ? v : Math.round(v * 1e4) / 1e4);

/** Small deterministic PRNG (mulberry32) so a render is reproducible; the client uses `Math.random()`. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Shared state of one render: resolved assets, the `<defs>` they need, and the random source.
 * @param {{resolve:Function}|null} resolver
 */
export function createTextureContext(resolver, seed = 1) {
  return { resolver, defs: new Map(), assets: new Map(), random: seededRandom(seed), clipCounter: 0 };
}

function asset(ctx, key) {
  if (!ctx.resolver?.resolve) return null;
  if (!ctx.assets.has(key)) ctx.assets.set(key, ctx.resolver.resolve({ key, source: key, kind: "ground-texture" }) ?? null);
  return ctx.assets.get(key);
}

/** The `<defs>` node for every tile symbol, overlay filter and clip used so far (null when none). Emit once, before the grounds. */
export function textureDefs(ctx) {
  return defsNode([...ctx.defs.values()]);
}

/**
 * `$T_n` tiles that cover their whole 40x40 cell: rasterised once (Chromium, 40x40, effects applied) and kept when at least 99% of
 * the pixels are covered and 30% or more are fully opaque. Tiles like the cobweb (28, lines on transparent), the edge rows
 * and the translucent 13 to 16 are not in it and never get a backdrop.
 */
const OPAQUE_TILES = new Set([0, 1, 2, 3, 4, 5, 12, 17, 18, 41, 42, 49, 50, 60, 61]);

/** First solid fill of an SVG data URI: the colour of the biggest area, used to back the tile (see `tileSymbolElement`). */
function backdropColor(href) {
  const m = /^data:image\/svg\+xml;base64,(.*)$/.exec(href ?? "");
  if (!m) return null;
  const svg = Buffer.from(m[1], "base64").toString("utf8");
  return /\sfill="(#[0-9a-fA-F]{6})"/.exec(svg)?.[1] ?? null;
}

/**
 * `<symbol>` for tile `n`. With `opaque` (and the tile in `OPAQUE_TILES`) the tile gets a backdrop of its first fill colour: Flash fills the cells of a shape
 * without seams, but separately anti-aliased SVG paths leave hairlines the map background shines through. Only tiles
 * that cover their whole cell (the interior `fill` lists) may take it; edge tiles have transparent parts.
 */
function tileSymbolElement(ctx, n, opaque = false) {
  const id = opaque ? `tile-${n}-opaque` : `tile-${n}`;
  if (ctx.defs.has(id)) return id;
  const a = asset(ctx, tileSymbol(n));
  if (!a?.href) return null;
  // The clip is drawn at its registration point into a 40x40 bitmap: anything outside is cropped by the symbol viewport.
  const x = -(a.origin?.x ?? 0);
  const y = -(a.origin?.y ?? 0);
  const color = opaque && OPAQUE_TILES.has(n) ? backdropColor(a.href) : null;
  ctx.defs.set(id, {
    type: "symbol", id, viewBox: `0 0 ${TILE_SIZE} ${TILE_SIZE}`, width: TILE_SIZE, height: TILE_SIZE, overflow: "hidden",
    children: [
      color ? { type: "rect", width: TILE_SIZE, height: TILE_SIZE, fill: color } : null,
      { type: "image", href: a.href, x: num(x), y: num(y), width: num(a.width ?? TILE_SIZE), height: num(a.height ?? TILE_SIZE) },
    ],
  });
  return id;
}

/** The `<use>` node of tile `n` in a cell; false for a cell outside the viewport (`ctx.cell`), null when the tile is missing. */
function tileUse(ctx, n, col, row, opaque = false) {
  if (ctx.cell && !ctx.cell(col, row)) return asset(ctx, tileSymbol(n))?.href ? false : null;
  const id = tileSymbolElement(ctx, n, opaque);
  if (!id) return null;
  return { type: "use", href: `#${id}`, x: col * TILE_SIZE, y: row * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE };
}

const pick = (ctx, tiles) => tiles[Math.floor(ctx.random() * tiles.length)];

/** Every cell from (fromCol, fromRow) on gets a random piece of `tiles`. */
function fill(ctx, out, tiles, cols, rows, fromCol = 0, fromRow = 0) {
  for (let col = fromCol; col < cols; col++) {
    for (let row = fromRow; row < rows; row++) {
      const use = tileUse(ctx, pick(ctx, tiles), col, row, true);
      if (use === null) return false;
      out.push(use);
    }
  }
  return true;
}

/** The top row, a random piece per column. */
function topRow(ctx, out, tiles, cols) {
  for (let col = 0; col < cols; col++) {
    const use = tileUse(ctx, pick(ctx, tiles), col, 0);
    if (use === null) return false;
    out.push(use);
  }
  return true;
}

/** Random top row between two corner pieces, fixed pieces down the left and right column. */
function framedTopRow(ctx, out, edge, cols, rows) {
  const last = cols - 1;
  const parts = [];
  for (let col = 1; col < last; col++) parts.push([pick(ctx, edge.tiles), col, 0]);
  parts.push([edge.corners.topLeft, 0, 0], [edge.corners.topRight, last, 0]);
  for (let row = 1; row < rows; row++) parts.push([edge.corners.left, 0, row], [edge.corners.right, last, row]);
  for (const [n, col, row] of parts) {
    const use = tileUse(ctx, n, col, row);
    if (use === null) return false;
    out.push(use);
  }
  return true;
}

function clipped(ctx, width, height, inner) {
  const id = `ground-clip-${ctx.clipCounter++}`;
  ctx.defs.set(id, { type: "clipPath", id, children: [{ type: "rect", x: 0, y: 0, width: num(width), height: num(height) }] });
  return group({ clipPath: id }, inner);
}

/** `ColorTransform(r/128, g/128, b/128)` as an SVG filter; null for the neutral tint 0x808080. */
function tintFilter(ctx, tint) {
  if (tint == null) return null;
  const value = (Number(tint) >>> 0) & 0xffffff;
  if (value === 0x808080) return null;
  const id = `tint-${value.toString(16).padStart(6, "0")}`;
  if (!ctx.defs.has(id)) {
    const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => num(c / 128));
    ctx.defs.set(id, {
      type: "filter", id, region: { x: 0, y: 0, width: "100%", height: "100%" },
      effect: { kind: "colorMatrix", matrix: [r, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, b, 0, 0, 0, 0, 0, 1, 0] },
    });
  }
  return id;
}

function stretched(a, x, y, boxWidth, boxHeight, blend) {
  const bw = a.width ?? boxWidth;
  const bh = a.height ?? boxHeight;
  const sx = boxWidth / bw;
  const sy = boxHeight / bh;
  const ox = -(a.origin?.x ?? 0) * sx;
  const oy = -(a.origin?.y ?? 0) * sy;
  return { type: "image", href: a.href, x: num(x + ox), y: num(y + oy), width: num(boxWidth), height: num(boxHeight), preserveAspectRatio: "none", blend };
}

/** The pre-rendered 400x400 ("S") or 100x100 ("S2", under 20 px) bitmap of `$Sol_*`, stretched to the ground. */
function pregenerated(ctx, recipe, width, height) {
  const symbol = PREGENERATED_SYMBOLS[recipe.pregenerated];
  const a = asset(ctx, symbol);
  if (!a?.href) return null;
  const small = width < 20 || height < 20;
  const canvas = small ? 100 : 400;
  const inset = small ? 0 : 2; // the game draws the large one into 396x396 inside the 400x400 bitmap
  const inner = stretched(a, inset, inset, canvas - 2 * inset, canvas - 2 * inset);
  return group({ transform: [["scale", num(width / canvas), num(height / canvas)]] }, inner);
}

/**
 * Draw one textured ground.
 * @param {ReturnType<typeof createTextureContext>} ctx
 * @param {{type:number, width:number, height:number, dynamic:boolean, tint?:number, minimalistForced?:boolean, pregeneratedForced?:boolean, cell?:Function}} ground
 *   `cell(col, row)` is false for a tile cell outside the viewport: it is left out (its random piece is still drawn, so the
 *   other cells get the same pieces as in a full picture)
 * @returns {{base:object, strip:object|null}|null} scene nodes; `strip` is the galaxy's top strip, drawn behind its ground and the mice; null when
 *   the type has no texture recipe or an asset is missing.
 */
export function renderTexturedGround(ctx, ground) {
  ctx.cell = ground.cell ?? null;
  try {
    return texturedGround(ctx, ground);
  } finally {
    ctx.cell = null;
  }
}

function texturedGround(ctx, ground) {
  const recipe = GROUND_TEXTURE_RECIPES[ground.type];
  const { width, height } = ground;
  const pregen = isPregenerated({ dynamic: ground.dynamic, width, height, forced: ground.pregeneratedForced });
  const filter = tintFilter(ctx, ground.tint);
  const wrap = (inner) => (filter ? group({ filter }, inner) : inner);

  if (!recipe) {
    // Every type without a recipe (16, 22 and up) is the `$Sol_Dur` clip stretched to the ground.
    const a = asset(ctx, DEFAULT_GROUND_SYMBOL);
    return a?.href ? { base: wrap(stretched(a, 0, 0, width, height)), strip: null } : null;
  }
  if (!(recipe.fill || recipe.edge || recipe.topRow || recipe.pregenerated !== undefined)) return null;

  if (recipe.pregenerated !== undefined) {
    if (pregen || !recipe.symbol) {
      const inner = pregenerated(ctx, recipe, width, height);
      return inner ? { base: wrap(inner), strip: null } : null;
    }
    const a = asset(ctx, recipe.symbol);
    return a?.href ? { base: wrap(stretched(a, 0, 0, width, height)), strip: null } : null;
  }

  const cols = Math.ceil(width / TILE_SIZE);
  const rows = Math.ceil(height / TILE_SIZE);
  const out = [];
  let strip = null;
  if (recipe.fill && !fill(ctx, out, recipe.fill.tiles, cols, rows, recipe.fill.fromCol, recipe.fill.fromRow)) return null;
  if (recipe.edge) {
    const ok = width % TILE_SIZE === 0 ? framedTopRow(ctx, out, recipe.edge, cols, rows) : topRow(ctx, out, recipe.edge.tiles, cols);
    if (!ok) return null;
  }
  // The galaxy recipe lists the same row twice, once into the strip and once into the ground; the game only draws the
  // strip for a map ground, so the list is not also drawn into the ground bitmap.
  const stripLists = new Set((recipe.topRow ?? []).filter((p) => p.into === "strip").map((p) => JSON.stringify(p.tiles)));
  for (const pass of recipe.topRow ?? []) {
    if (pass.into === "ground" && stripLists.has(JSON.stringify(pass.tiles))) continue;
    if (pass.into === "strip") {
      // Galaxy: the game draws this row into its own bitmap in the grounds layer, behind the mice, following the ground.
      const stripOut = [];
      if (!topRow(ctx, stripOut, pass.tiles, cols)) return null;
      strip = wrap(clipped(ctx, width, Math.min(height, TILE_SIZE), stripOut));
    } else if (!topRow(ctx, out, pass.tiles, cols)) return null;
  }
  const base = [clipped(ctx, width, height, out)];
  if (recipe.overlay && !pregen) {
    const overlay = asset(ctx, recipe.overlay);
    if (overlay?.href) base.push(stretched(overlay, 0, 0, width, height, "overlay"));
  }
  return { base: wrap(base), strip };
}
