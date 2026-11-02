// Shaman objects (`<O C="...">`): which types exist, which the game creates, nails, skins. docs/xml/objects.md shows
// these lists (tools/gen-docs.mjs).

/** Base types the game never creates from a map (they may still appear in maps). */
export const FILTERED_TYPES = Object.freeze([26, 27, 44, 79, 84, 85, 86, 94, 96]);

/**
 * Base types the game creates from a map. Every other type is dropped by the game, though an editor may still draw it.
 * 28 stands for the balloons 28 to 31 (the game picks one at random). 24 only plays a one-off effect, so it is not listed.
 */
export const CREATED_TYPES = Object.freeze([
  0, 1, 2, 3, 4, 6, 7, 10, 17, 23, 28, 32, 33, 34, 35, 39, 40, 45, 46, 54, 57, 59, 60, 61, 62, 63, 65, 67, 68, 69, 80, 89, 90, 95, 97,
]);

/** Nails: they join the bodies under their point instead of being objects themselves. */
export const NAIL_TYPES = Object.freeze([11, 12, 13, 14, 15, 16, 22, 112, 113]);

/** Nails that attach to the world: one body under the point is enough. The other nails need two. */
export const WORLD_NAIL_TYPES = Object.freeze([11, 12, 13, 112, 113]);

/** Nails with a motor (they spin what they hold). */
export const ROTATING_NAIL_TYPES = Object.freeze([12, 13, 15, 16, 112, 113]);

/** At most this many joints of the nails 12, 13, 15 and 16 per map; the next one is refused. */
export const ROTATING_NAIL_LIMIT = 11;

/** Types with no picture in the game's libraries. */
export const NO_PICTURE_TYPES = Object.freeze([5, 8, 9, 21, 64]);

/** In defilante mode these raw `C` values are markers (marker kind 0 to 3), not objects. */
export const DEFILANTE_MARKERS = Object.freeze({ 6: 0, 32: 1, 15: 2, 16: 3 });

/** Picture names that differ from `$Objet_<C>`. */
export const SPECIAL_PICTURES = Object.freeze({
  28: "a random one of `$Objet_28` to `$Objet_31` (balloons)",
  54: "`$GlaconChamane`",
  85: "`$Objet_Avalanche`",
  96: "`$Cage`",
});

/**
 * Split a `C` value into base type and skin:
 *   above 9999: base = int((C - 10000) / 10000), skin = (C - 10000) % 10000
 *   above 99:   base = int(C / 100), skin = C % 100
 *   otherwise:  base = C, skin 0
 */
export function splitObjectType(c) {
  if (c > 9999) return { baseType: Math.trunc((c - 10000) / 10000), skin: (c - 10000) % 10000 };
  if (c > 99) return { baseType: Math.trunc(c / 100), skin: c % 100 };
  return { baseType: c, skin: 0 };
}

/** Colour transform of a ghost object (`P` second field 1): alpha halved, green and blue +40. Type 32 ghosts the solid one instead. */
export const GHOST_TRANSFORM = Object.freeze({ multiply: Object.freeze([1, 1, 1, 0.5]), add: Object.freeze([0, 40, 40, 0]) });
