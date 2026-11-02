// Re-applies what FFDec's SVG export drops from a sprite's display list: the colour transform of each placed
// instance and blend modes without a CSS name (see src/swf/display-list.js). The placements come from the release's
// `effects.json`; they line up with the first-level `<use>` elements of the normalised SVG body, in depth order.

import { BLEND_MODES } from "../swf/display-list.js";
import { as3Int } from "../tfm/codecs.js";

const num = (v) => String(Math.round(v * 1e5) / 1e5);

/** `[mul, add]` as an SVG colour matrix: out = mul * in + add / 255 per channel (alpha included). */
function colorMatrix({ mul, add }) {
  const row = (i) => {
    const r = [0, 0, 0, 0, num(add[i] / 255)];
    r[i] = num(mul[i]);
    return r.join(" ");
  };
  return [0, 1, 2, 3].map(row).join("  ");
}

/**
 * Whether the group a `<use>` points at paints with a gradient anywhere below it. FFDec bakes a colour transform into SOLID fills
 * (every instance becomes its own `<g id=\"shapeN\">` with the transformed colours: re-applying it would double it). Gradients are
 * baked too whenever the placement has no blend mode (decoration leaves and mouse holes match the game without any re-application); only
 * a placement WITH a blend mode (the add-blended glow of the lava and ice tiles, ...) keeps its gradient untouched, so only those need it.
 */
function hasGradient(useTag, defs, seen = new Set()) {
  const ref = /href="#([^"]+)"/.exec(useTag)?.[1];
  if (!ref || seen.has(ref)) return false;
  seen.add(ref);
  const group = new RegExp(`<g id="${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">(.*?)</g>`).exec(defs ?? "");
  if (!group) return false;
  if (/fill="url\(/.test(group[1])) return true;
  return [...group[1].matchAll(/<use\b[^>]*\/>/g)].some((m) => hasGradient(m[0], defs, seen));
}

/** `s` for a use of a nested sprite, `h` for a shape, `o` otherwise, per `<use>` element (compared with the SWF's own children). */
function kindsOfUses(uses) {
  return uses.map((m) => (/href="#[^"]*_sprite\d+"/.test(m[0]) ? "s" : /href="#[^"]*_shape\d+"/.test(m[0]) ? "h" : "o")).join("");
}

/** Re-applies `placements` to the `<use>` elements of `markup`; `state` numbers the filters. Returns the markup and the new filters. */
function patchUses(markup, placements, colors, state, kinds, gradients) {
  if (colors) placements = placements.map((p) => (/^Couleur\d/.test(p.name ?? "") ? { ...p, cx: colorTransformOf(colors[Number(p.name[7])]), always: true } : p));
  if (!placements.some((p) => p.cx || (p.blend && BLEND_MODES[p.blend]))) return markup;
  const uses = [...markup.matchAll(/<use\b[^>]*\/>/g)];
  if (uses.length !== placements.length) return markup;
  if (kinds && kinds !== kindsOfUses(uses)) return markup; // the group is not the sprite these placements belong to
  let out = "";
  let last = 0;
  uses.forEach((match, i) => {
    const p = placements[i];
    let tag = match[0];
    if (p.cx && (p.always || p.nm || ((gradients || p.blend) && hasGradient(tag, state.defs)))) {
      const id = `fxcx${state.n++}`;
      state.filters += `<filter id="${id}" color-interpolation-filters="sRGB" x="-10%" y="-10%" width="120%" height="120%"><feColorMatrix type="matrix" values="${colorMatrix(p.cx)}"/></filter>`;
      tag = /\sfilter="/.test(tag)
        ? tag.replace(/\sfilter="([^"]*)"/, (_, f) => ` filter="${f} url(#${id})"`)
        : tag.replace("<use", `<use filter="url(#${id})"`);
    }
    const blend = p.blend ? BLEND_MODES[p.blend] : null;
    if (blend && !/mix-blend-mode/.test(tag)) tag = tag.replace("<use", `<use style="mix-blend-mode: ${blend}"`);
    out += markup.slice(last, match.index) + tag;
    last = match.index + match[0].length;
  });
  return out + markup.slice(last);
}

/**
 * @param {{defs:string, body:string}} vector first-level markup of a normalised sprite
 * @param {Array<{cx:{mul:number[],add:number[]}|null, blend:number|null, name?:string}>|{top:Array<object>, nested:Record<string,Array<object>>}} placements
 *   first-frame placements in depth order (`effects.json` entry); `nested` holds those of the sprites inside, by the name FFDec gave
 *   them (`sprite0`, ...), which are patched inside `defs`
 * @param {{colors?: string[]}} [options] `colors`: the hex colour list of a decoration's `C` attribute; every placement named
 *   `Couleur<n>...` is then drawn with the colour `colors[n]` (spec: D/P.C; a missing entry is black, as `int("0xundefined")` is 0)
 * @returns {{defs:string, body:string}} the same markup when nothing applies or the counts do not line up
 */
export function applyClipEffects(vector, placements, { colors, gradients = true } = {}) {
  if (!placements) return vector;
  const top = Array.isArray(placements) ? placements : placements.top;
  const nested = Array.isArray(placements) ? {} : placements.nested ?? {};
  const topKinds = Array.isArray(placements) ? undefined : placements.kinds;
  let defs = vector.defs ?? "";
  const state = { n: 0, filters: "", defs };
  for (const [label, entry] of Object.entries(nested)) {
    const rows = Array.isArray(entry) ? entry : entry.rows;
    defs = defs.replace(new RegExp(`(<g id="[^"]*_${label}">)(.*?)(</g>)`), (_, open, inner, close) => open + patchUses(inner, rows, colors, state, entry.kinds, gradients) + close);
  }
  const body = patchUses(vector.body, top, colors, state, topKinds, gradients);
  if (!state.filters) return defs === (vector.defs ?? "") && body === vector.body ? vector : { defs, body };
  return { defs: defs + state.filters, body };
}

/** `ColorTransform(r/128, g/128, b/128)` of a hex colour string (`int("0x" + value)`; anything unreadable is 0 = black). */
export function colorTransformOf(hex) {
  const v = Number.parseInt(String(hex), 16);
  const n = Number.isFinite(v) ? v & 0xffffff : 0;
  return { mul: [((n >> 16) & 255) / 128, ((n >> 8) & 255) / 128, (n & 255) / 128, 1], add: [0, 0, 0, 0] };
}

/**
 * Skinned shaman objects colour their parts by instance name: a child called `Couleur<n>_<RRGGBB>` is drawn with
 * `ColorTransform(r/128, g/128, b/128)` of that default colour (docs/rendering.md#pictures-from-the-game).
 */
export function colourFromName(name) {
  // Any child whose name starts with `Couleur`; colour = `int("0x" + name.split("_")[1])` (any number of digits: a typo such as `Couleur1_EF08D2A`
  // has seven; a missing or non-hex part is 0, i.e. black); channels = `>> 16 & 255`, `>> 8 & 255`, `& 255`.
  if (!/^Couleur/.test(name ?? "")) return null;
  const v = as3Int(`0x${String(name).split("_")[1] ?? "undefined"}`);
  return { mul: [((v >> 16) & 255) / 128, ((v >> 8) & 255) / 128, (v & 255) / 128, 1], add: [0, 0, 0, 0] };
}

/**
 * Placements worth keeping: `{symbol: rows}` for sprites where at least one instance (at the first level or inside a nested sprite)
 * is transformed or blended, or (without `nameColours`) is a `Couleur<n>` instance a decoration's `C` colours can paint. A row is
 * `{cx, blend, name?, nm?}` (`nm`: the colour comes from the instance name, so FFDec baked nothing); `rows` is the array for the first level, or `{top, kinds, nested: {sprite0: {rows, kinds}, ...}}` when nested sprites matter.
 * With `nameColours` (the shaman-items bundle: the game draws skins with the default colour in the instance name) the name gives the
 * colour transform directly.
 * @param {Map<string, Array<object>|{placements:Array<object>, nested:Record<string,Array<object>>}>} placementsByName
 */
export function compactPlacements(placementsByName, { nameColours = false } = {}) {
  const rowsOf = (list) => list.map((p) => {
    const row = { cx: p.colorTransform ?? (nameColours ? colourFromName(p.name) : null), blend: p.blend };
    // A colour taken from the instance name was never in the SWF as a transform, so FFDec did not bake it into the fills: it must always be applied (`nm`).
    if (!p.colorTransform && row.cx) row.nm = true;
    if (!nameColours && /^Couleur\d/.test(p.name ?? "")) row.name = p.name;
    return row;
  });
  const kindsOf = (list) => list.map((p) => (p.kind === "sprite" ? "s" : p.kind === "shape" ? "h" : "o")).join("");
  const matters = (rows) => rows.some((r) => r.cx || r.name || (r.blend && BLEND_MODES[r.blend]));
  const out = {};
  for (const [name, entry] of placementsByName) {
    const list = Array.isArray(entry) ? entry : entry.placements;
    const top = rowsOf(list);
    const nested = {};
    for (const [label, nestedList] of Object.entries(Array.isArray(entry) ? {} : entry.nested)) {
      const rows = rowsOf(nestedList);
      if (matters(rows)) nested[label] = { rows, kinds: kindsOf(nestedList) };
    }
    if (Object.keys(nested).length) out[name] = { top, kinds: kindsOf(list), nested };
    else if (matters(top)) out[name] = top;
  }
  return out;
}
