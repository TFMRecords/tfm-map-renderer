// What the game does with a shaman object of a map, for the renderer's "game" object mode
// (docs/xml/objects.md#which-objects-exist).

/**
 * Base types the game creates. Any other type is not created,
 * so the game draws nothing for it (the in-game editor still shows them). The arrow (0) is special-cased and drawn in the mice layer.
 */
export const GAME_OBJECT_TYPES = Object.freeze(new Set([
  0, 1, 2, 3, 4, 6, 7, 10, 17, 23, 28, 32, 33, 34, 35, 39, 40, 45, 46, 54, 57, 59, 60, 61, 62, 63, 65, 67, 68, 69, 80, 89, 90, 95, 97,
]));

/** Types the game refuses to create (as are 44, the portals 26/27 and the nails). */
export const GAME_REFUSED_TYPES = Object.freeze(new Set([
  36, 37, 38, 42, 43, 47, 55, 56, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 81, 82, 83, 84, 86, 92, 93, 94,
]));

/** Nails: made when the map is read, and only visible once they join enough bodies (docs/xml/objects.md#nails). */
export const NAIL_TYPES = Object.freeze(new Set([11, 12, 13, 14, 15, 16, 22, 112, 113]));

/** Nails that attach to the world (11, 12, 13, 112, 113 need one body under the point, the others two; grounds are not bodies). */
export const WORLD_NAIL_TYPES = Object.freeze(new Set([11, 12, 13, 112, 113]));

/** Whether the game draws an object of this base type at all (before physics: a nail may still stay invisible). */
export function gameCreatesObject(baseType, type = baseType) {
  if (NAIL_TYPES.has(type) || NAIL_TYPES.has(baseType)) return false;
  if (GAME_REFUSED_TYPES.has(baseType) || baseType === 44 || baseType === 26 || baseType === 27) return false;
  return GAME_OBJECT_TYPES.has(baseType >= 28 && baseType <= 31 ? 28 : baseType);
}

/**
 * The ghost look (docs/xml/objects.md#ghosts): `ColorTransform(1, 1, 1, 0.5, 0, 40, 40)`, alpha halved and green and blue
 * raised by 40. The game applies it to a ghost object, except to type 32, where it is the solid one that gets it.
 */
export const GHOST_COLOR_TRANSFORM = Object.freeze({ mul: [1, 1, 1, 0.5], add: [0, 40, 40, 0] });

/** Whether the client draws the object with the ghost transform. */
export function isDrawnGhost(object) {
  return object.baseType === 32 ? !object.ghost : Boolean(object.ghost);
}
