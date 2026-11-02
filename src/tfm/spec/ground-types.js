// Ground types (`<S T="...">`): what the game does with each type before any attribute is applied. Names follow the
// usual editor names; the game itself only uses numbers. docs/xml/grounds.md shows the table (tools/gen-docs.mjs).

/** Physics every type starts from (friction and restitution of `P` fields 3 and 4). */
export const DEFAULT_GROUND_PHYSICS = Object.freeze({ friction: 0.3, restitution: 0.2 });

const T = (type, name, o = {}) => Object.freeze({
  type, name,
  friction: DEFAULT_GROUND_PHYSICS.friction, restitution: DEFAULT_GROUND_PHYSICS.restitution,
  bitmapCached: false, foreground: false, note: "",
  ...o,
});

/**
 * One entry per type 0 to 21.
 *   friction, restitution  starting values (a written `P` replaces them)
 *   bitmapCached           a static ground of this type is cached as a bitmap by the game (a drawing hint, no physics meaning)
 *   foreground             always drawn in front of the mice, with or without `N`
 */
export const GROUND_TYPES = Object.freeze([
  T(0, "wood", { friction: 0.05, restitution: 0.1, bitmapCached: true }),
  T(1, "ice", { friction: 0 }),
  T(2, "trampoline", { friction: 0, restitution: 1.2 }),
  T(3, "lava", { restitution: 20, bitmapCached: true }),
  T(4, "chocolate", { friction: 20 }),
  T(5, "earth", { bitmapCached: true }),
  T(6, "grass", { bitmapCached: true }),
  T(7, "sand", { friction: 0.1, bitmapCached: true }),
  T(8, "cloud", { note: "Collision group 0 collides with shaman objects only." }),
  T(9, "water", { foreground: true, note: "An area: collision group always 5, `P` is ignored, area physics attributes apply." }),
  T(10, "stone", { restitution: 0, bitmapCached: true }),
  T(11, "snow", { bitmapCached: true }),
  T(12, "rectangle", { note: "Plain colour `o` (white without it)." }),
  T(13, "circle", { note: "Plain colour `o` (white without it); `L` is the radius, `H` is ignored." }),
  T(14, "invisible", { note: "Not drawn." }),
  T(15, "cobweb", { foreground: true, note: "An area: collision group always 5, area physics attributes apply." }),
  T(16, "wood2", { note: "Drawn with the plain plank picture." }),
  T(17, "grass2"),
  T(18, "grass3"),
  T(19, "acid", { note: "The body is marked as acid." }),
  T(20, "honey", { note: "Honey `20,4` unless `friction` says otherwise." }),
  T(21, "galaxy", { foreground: true, note: "A cup-shaped frame rather than a solid block; the top strip is drawn behind the mice." }),
]);

/** Types 0 to 21 are defined; any other number is drawn like wood (the plain plank picture) with the default physics. */
export const UNKNOWN_GROUND_TYPE = Object.freeze({ name: "unknown", drawnAs: 0, ...DEFAULT_GROUND_PHYSICS });

/** Width and height (`L`, `H`) are kept in this range. */
export const GROUND_SIZE = Object.freeze({ min: 10, max: 4000 });

/** Area physics of water (9) and cobweb (15) before any attribute is applied. */
export const AREA_DEFAULTS = Object.freeze({
  9: Object.freeze({ archAcc: 0.1, archMax: 0.5, archCheeseMax: 0.25, linDampAcc: 0, linDampMax: 0, angDampAcc: 0, angDampMax: 0 }),
  15: Object.freeze({ archAcc: 0.1, archMax: 0.3, archCheeseMax: 0.3, linDampAcc: 0.5, linDampMax: 28, angDampAcc: 0.2, angDampMax: 20 }),
});

/**
 * Collision presets. Two shapes collide when each one's mask contains the other's category bit. The labels of
 * categories 1, 2 (mice) and 8 (shaman objects) are inferred; the bits are verified.
 */
export const COLLISION_PRESETS = Object.freeze([
  Object.freeze({ preset: 0, category: 32, mask: 0, usedFor: "ground `c` 4 and above, water, cobweb" }),
  Object.freeze({ preset: 1, category: 1, mask: 22, usedFor: "not a ground (mice, inferred)" }),
  Object.freeze({ preset: 2, category: 2, mask: 23, usedFor: "not a ground (mice, inferred)" }),
  Object.freeze({ preset: 3, category: 4, mask: 15, usedFor: "ground `c` 0 or 1" }),
  Object.freeze({ preset: 4, category: 8, mask: 12, usedFor: "ground `c` 2; a cloud (8) with `c` 0" }),
  Object.freeze({ preset: 5, category: 16, mask: 3, usedFor: "ground `c` 3; the walls around the map" }),
]);

/** Dynamic grounds: density of every shape. Shapes otherwise start with friction 0.2, restitution 0, density 0. */
export const DYNAMIC_GROUND_DENSITY = 30;

/** Honey (`friction` attribute) of type 20 when the attribute is absent. */
export const HONEY_DEFAULT = Object.freeze([20, 4]);
