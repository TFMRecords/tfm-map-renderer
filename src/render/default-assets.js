// Built-in stand-ins used when no asset bundle is available (offline mode, or an asset that is missing).
// Every value here is a PLACEHOLDER chosen for legibility, not extracted from the game: ground types are
// drawn as plain filled shapes so a map is still readable without any image.

/**
 * Placeholder fill per ground type (`T`): the alpha-weighted mean colour of the third-party editor Miceditor's texture for
 * that type. `top` is a strip along the upper
 * edge for the types whose texture has a distinct top (mean colour of the `*-top.png` texture, its height in pixels).
 * `opacity` is below 1 for the translucent textures (never below 0.4, so they stay visible).
 * These are stand-ins, not the game's artwork.
 */
export const DEFAULT_GROUND_STYLES = Object.freeze({
  0: { name: "wood", fill: "#937050" },
  1: { name: "ice", fill: "#abccdb", opacity: 0.81 },
  2: { name: "trampoline", fill: "#543472" },
  3: { name: "lava", fill: "#a83f03" },
  4: { name: "chocolate", fill: "#5a2710" },
  5: { name: "earth", fill: "#462813" },
  6: { name: "grass", fill: "#565311", top: { fill: "#637510", height: 15 } },
  7: { name: "sand", fill: "#eacc59" },
  8: { name: "cloud", fill: "#ddf6ff", opacity: 0.4 },
  9: { name: "water", fill: "#6bffee", opacity: 0.46 },
  10: { name: "stone", fill: "#5d584c" },
  11: { name: "snow", fill: "#655c3c", top: { fill: "#f4f2f1", height: 13 } },
  12: { name: "rectangle", fill: "#ffffff" }, // white when `o` is absent, as in the game
  13: { name: "circle", fill: "#ffffff" },
  14: { name: "invisible", fill: null },
  15: { name: "cobweb", fill: "#fefeff", opacity: 0.4 },
  16: { name: "wood2", fill: "#937050" },
  17: { name: "grass2", fill: "#7c5915", top: { fill: "#a68214", height: 16 } },
  18: { name: "grass3", fill: "#7b5256", top: { fill: "#93667d", height: 15 } },
  19: { name: "acid", fill: "#5fc00e", top: { fill: "#68b72b", height: 15 } },
  20: { name: "honey", fill: "#d29f2b", top: { fill: "#deaf1b", height: 15 } },
  21: { name: "galaxy", fill: "#100020", top: { fill: "#210039", height: 20 } },
});

/**
 * Ground types the game does not define (some real maps use them). The game draws them with the `$Sol_Dur`
 * clip, the plain plank it also uses for wood (docs/xml/grounds.md#ground-types).
 */
export const UNKNOWN_GROUND_STYLE = Object.freeze({ ...DEFAULT_GROUND_STYLES[0], name: "unknown (wood)" });

export const DEFAULT_MARKER_STYLES = Object.freeze({
  "mouse-spawn": { fill: "#ffffff", stroke: "#444444", r: 6 },
  "shaman-spawn": { fill: "#6fa8ff", stroke: "#1d4ea8", r: 6 },
  "dual-shaman-spawn": { fill: "#ff9ec7", stroke: "#a8195b", r: 6 },
  cheese: { fill: "#ffd84a", stroke: "#a88a00", r: 5 },
  hole: { fill: "#241812", stroke: "#000000", rx: 11, ry: 6 },
});

export function groundStyle(type) {
  return DEFAULT_GROUND_STYLES[type] ?? UNKNOWN_GROUND_STYLE;
}

/** `0xRRGGBB` integer (as the client reads `o`) to `#rrggbb`. Alpha bytes and wrap-around are dropped. */
export function colorToHex(value) {
  return `#${((Number(value) >>> 0) & 0xffffff).toString(16).padStart(6, "0")}`;
}
