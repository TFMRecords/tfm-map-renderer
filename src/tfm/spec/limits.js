// Limits of the map editor and of the game client. None of them is applied by the parser; the renderer takes them as
// options (`clientLimits`). docs/xml/limits-and-modes.md shows the tables (tools/gen-docs.mjs).

/** Characters the in-game editor lets you save. The game itself reads anything. */
export const EDITOR_CHARACTERS = Object.freeze({
  pattern: /^[A-Za-z0-9 <>"'\-_.,:;=/#]*$/,
  description: "`a-z`, `A-Z`, `0-9`, the space (no tab, no newline) and `< > \" ' - _ . , : ; = / #`",
});

/** Map size: the default, and the documented maximum (enforced only for restricted maps). */
export const MAP_SIZE = Object.freeze({ defaultWidth: 800, defaultHeight: 400, maxWidth: 1600, maxWidthDefilante: 4800, maxHeight: 800 });

/**
 * What a restricted map loses. A map is restricted when it is an ordinary player map: not an official map (author
 * `Tigrounette`, `Transformice` or a name starting with `_`) and not loaded as `#Module`.
 *   restricted  the value for a restricted map
 *   official    for an official map
 *   module      for a `#Module` map
 */
export const RESTRICTED_LIMITS = Object.freeze([
  Object.freeze({ what: "Map width `L`", restricted: "at most 1600 (4800 with `defilante`)", official: "no limit", module: "no limit" }),
  Object.freeze({ what: "Map height `H`", restricted: "at most 800", official: "no limit", module: "no limit" }),
  Object.freeze({ what: "Grounds", restricted: "the first 60", official: "all", module: "all" }),
  Object.freeze({ what: "Decoration-container children", restricted: "the first 50", official: "all", module: "all" }),
  Object.freeze({ what: "Shaman objects", restricted: "the first 40, and none after child index 200", official: "all", module: "all" }),
  Object.freeze({ what: "Tiled background `D=\"#url,w,h\"`", restricted: "ignored", official: "drawn", module: "drawn" }),
  Object.freeze({ what: "Repeated `D` and `d` images", restricted: "ignored", official: "drawn", module: "drawn" }),
  Object.freeze({ what: "Ground image `i`", restricted: "ignored", official: "drawn", module: "drawn" }),
  Object.freeze({ what: "`APS`, `IP`", restricted: "ignored", official: "used", module: "used" }),
  Object.freeze({ what: "`ARPS`", restricted: "ignored", official: "used", module: "ignored" }),
  Object.freeze({ what: "Particles", restricted: "at most 5", official: "no limit", module: "at most 5" }),
]);

/** Limits that always apply. */
export const ALWAYS_LIMITS = Object.freeze([
  Object.freeze({ what: "Repeats of a `D` image", limit: "at most 20" }),
  Object.freeze({ what: "Repeats of a `d` image", limit: "no limit" }),
  Object.freeze({ what: "Numbers in `DS=\"m;...\"`", limit: "the first 40 (20 points)" }),
  Object.freeze({ what: "Ground `L` and `H`", limit: "kept between 10 and 4000" }),
  Object.freeze({ what: "Particle `dur`", limit: "at most 10000 ms" }),
]);

/** The in-game editor draws only the first 40 objects of a map. */
export const EDITOR_OBJECT_DRAW_LIMIT = 40;
