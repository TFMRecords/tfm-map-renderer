// Client limits for rendering: what the game client cuts or switches off depending on the context a map is loaded in
// (docs/xml/limits-and-modes.md#restricted-maps). The parser never applies any of this; a renderer picks a preset or custom values.
//
// A limits object:
//   restricted          switches off ground `i`, APS, IP, tiled `D` bitmaps and `D`/`d` repeat clones
//   arps                draws ARPS (the client needs `param4` for it, which `restricted: false` alone does not imply)
//   maxWidth            map width cap (1600); null = none
//   maxWidthDefilante   the width cap of a defilante map (4800)
//   maxHeight           map height cap (800)
//   maxGrounds          only the first N children of the ground container are read (60)
//   maxDecorations      only the first N children of the decoration container are read (50)
//   maxObjects          reading stops after N shaman objects (40); defilante marker types are not counted
//   maxObjectIndex      ... or at this child index (200)

const NONE = Object.freeze({
  restricted: false, arps: true,
  maxWidth: null, maxWidthDefilante: null, maxHeight: null, maxGrounds: null, maxDecorations: null, maxObjects: null, maxObjectIndex: null,
});

/** Named presets. `unrestricted` (the default) draws what the XML says. */
export const CLIENT_LIMIT_PRESETS = Object.freeze({
  /** An ordinary player map (not official, not `#Module`; it is how the map is opened that decides, not the room): every limit applies and the gated features are off. */
  restricted: Object.freeze({
    restricted: true, arps: false,
    maxWidth: 1600, maxWidthDefilante: 4800, maxHeight: 800, maxGrounds: 60, maxDecorations: 50, maxObjects: 40, maxObjectIndex: 200,
  }),
  /** A map whose author is `#Module`: no limits, gated features on, but not ARPS (it needs `param4`). */
  module: Object.freeze({ ...NONE, arps: false }),
  /** No limits and everything on: Lua-style unlimited maps and the editor's admin "no limit" mode. */
  unrestricted: NONE,
});

const NUMERIC = ["maxWidth", "maxWidthDefilante", "maxHeight", "maxGrounds", "maxDecorations", "maxObjects", "maxObjectIndex"];

/**
 * @param {string|false|null|undefined|object} spec a preset name (`"restricted"`, `"module"`, `"unrestricted"`), `false`/`"none"`
 *   for no limits, or an object of limit values, optionally with `preset` naming the base to override
 * @returns {typeof NONE}
 */
export function resolveClientLimits(spec) {
  if (spec == null || spec === false || spec === "none") return NONE;
  const base = (name) => {
    const preset = CLIENT_LIMIT_PRESETS[name];
    if (!preset) throw new RangeError(`unknown client limits preset "${name}" (use ${Object.keys(CLIENT_LIMIT_PRESETS).join(", ")})`);
    return preset;
  };
  if (typeof spec === "string") return base(spec);
  if (typeof spec !== "object") throw new TypeError("clientLimits must be a preset name or an object");
  const { preset = "unrestricted", ...custom } = spec;
  const out = { ...base(preset) };
  for (const [key, value] of Object.entries(custom)) {
    if (key === "restricted" || key === "arps") out[key] = Boolean(value);
    else if (NUMERIC.includes(key)) {
      if (value !== null && !(Number.isFinite(value) && value >= 0)) throw new RangeError(`clientLimits.${key} must be a non-negative number or null`);
      out[key] = value;
    } else throw new RangeError(`unknown clientLimits key "${key}"`);
  }
  return Object.freeze(out);
}

const DEFILANTE_MARKERS = new Set([6, 32, 15, 16]);

/**
 * A copy of the map as the client would read it under `limits`. The parsed map is never modified.
 * @param {object} map a parsed TfmMap
 * @param {ReturnType<typeof resolveClientLimits>} limits
 */
export function applyClientLimits(map, limits) {
  const defilante = map.settings?.defilante != null;
  const width = limits.maxWidth == null ? null : (defilante && limits.maxWidthDefilante != null ? limits.maxWidthDefilante : limits.maxWidth);
  const settings = { ...map.settings };
  if (width != null && Number(settings.width) > width) settings.width = width;
  if (limits.maxHeight != null && Number(settings.height) > limits.maxHeight) settings.height = limits.maxHeight;
  const first = (list, n) => (n == null ? list : list.slice(0, n));
  let objects = map.objects ?? [];
  if (limits.maxObjects != null || limits.maxObjectIndex != null) {
    const kept = [];
    let counted = 0;
    for (let i = 0; i < objects.length; i++) {
      if (counted === limits.maxObjects || (limits.maxObjectIndex != null && i >= limits.maxObjectIndex)) break;
      kept.push(objects[i]);
      if (!(defilante && DEFILANTE_MARKERS.has(Number(objects[i].type)))) counted++;
    }
    objects = kept;
  }
  return { ...map, settings, grounds: first(map.grounds ?? [], limits.maxGrounds), decorations: first(map.decorations ?? [], limits.maxDecorations), objects };
}
