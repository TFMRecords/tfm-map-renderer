// Numbers and small pure functions describing how the game reads a map, shared by the parser and the renderer.
// Documented in docs/xml/ (each block names its section); test/spec.test.js checks them against src/tfm/spec/.

/** Width and height of a ground are kept in this range (docs/xml/grounds.md#ground-types). */
export const GROUND_SIZE_LIMITS = Object.freeze({ min: 10, max: 4000 });
/** The gravity that replaces a `NaN` gravity in the settings `G` attribute (spec: P.G). */
export const DEFAULT_GRAVITY = 10;

export function clampGroundSize(value) {
  if (value < GROUND_SIZE_LIMITS.min) return GROUND_SIZE_LIMITS.min;
  if (GROUND_SIZE_LIMITS.max < value) return GROUND_SIZE_LIMITS.max;
  return value;
}

/** The seven attributes water (T=9) and cobweb (T=15) areas read, each as `number` when truthy (docs/xml/grounds.md#area-physics-water-and-cobweb). */
export const AREA_ATTRIBUTES = Object.freeze(["archAcc", "archMax", "archCheeseMax", "linDampAcc", "linDampMax", "angDampAcc", "angDampMax"]);

/** Area physics before any attribute is applied (docs/xml/grounds.md#area-physics-water-and-cobweb). */
export const AREA_DEFAULTS = Object.freeze({
  9: Object.freeze({ archAcc: 0.1, archMax: 0.5, archCheeseMax: 0.25, linDampAcc: 0, linDampMax: 0, angDampAcc: 0, angDampMax: 0 }),
  15: Object.freeze({ archAcc: 0.1, archMax: 0.3, archCheeseMax: 0.3, linDampAcc: 0.5, linDampMax: 28, angDampAcc: 0.2, angDampMax: 20 }),
});

/**
 * The collision presets, as category bit and the mask of category bits it collides with. Two shapes collide when each
 * one's mask contains the other's category bit (docs/xml/grounds.md#collision).
 */
export const COLLISION_PRESETS = Object.freeze({
  0: Object.freeze({ categoryBits: 32, maskBits: 0 }),
  1: Object.freeze({ categoryBits: 1, maskBits: 22 }),
  2: Object.freeze({ categoryBits: 2, maskBits: 23 }),
  3: Object.freeze({ categoryBits: 4, maskBits: 15 }),
  4: Object.freeze({ categoryBits: 8, maskBits: 12 }),
  5: Object.freeze({ categoryBits: 16, maskBits: 3 }),
});

/** The category bits set in `maskBits`, ascending. */
export function bitsOf(maskBits) {
  const out = [];
  for (let bit = 1; bit <= maskBits; bit <<= 1) if (maskBits & bit) out.push(bit);
  return out;
}

/** Whether a shape with preset `a` and one with preset `b` collide (both masks must accept the other's category). */
export function presetsCollide(a, b) {
  const x = COLLISION_PRESETS[a];
  const y = COLLISION_PRESETS[b];
  return Boolean(x && y && (x.maskBits & y.categoryBits) && (y.maskBits & x.categoryBits));
}

/** Defaults of a physics shape, and the density every shape of a dynamic ground gets (docs/xml/grounds.md#physics-p). */
export const SHAPE_DEFAULTS = Object.freeze({ friction: 0.2, restitution: 0, density: 0, isSensor: false });
export const DYNAMIC_GROUND_DENSITY = 30;

/** Defaults of a physics body; a dynamic ground overwrites damping and fixed rotation. */
export const BODY_DEFAULTS = Object.freeze({ linearDamping: 0, angularDamping: 0, fixedRotation: false, angle: 0, allowSleep: true });

/** Base object types the game does not create as shaman objects (docs/xml/objects.md#which-objects-exist). */
export const OBJECT_FILTER = Object.freeze(new Set([26, 27, 44, 79, 84, 85, 86, 94, 96]));

/**
 * Split an encoded object type into [baseType, skin] (docs/xml/objects.md#type-and-skin-c):
 *   C > 9999 -> [int((C - 10000) / 10000), (C - 10000) % 10000]
 *   C > 99   -> [int(C / 100), C % 100]
 *   else     -> [C, 0]
 */
export function decodeObjectType(c) {
  if (c > 9999) return { baseType: Math.trunc((c - 10000) / 10000), skin: (c - 10000) % 10000 };
  if (c > 99) return { baseType: Math.trunc(c / 100), skin: c % 100 };
  return { baseType: c, skin: 0 };
}

// Starting friction and restitution of every ground type that does not override them. The game adds a random amount
// below 1e-6 to both at run time; that is not modelled here.
const DEFAULT_FRICTION = 0.3;
const DEFAULT_RESTITUTION = 0.2;

/** Friction and restitution per ground type, where they differ from the defaults (docs/xml/grounds.md#ground-types). */
const TYPE_PHYSICS = Object.freeze({
  0: { friction: 0.05, restitution: 0.1 },
  1: { friction: 0 },
  2: { friction: 0, restitution: 1.2 },
  3: { restitution: 20 },
  4: { friction: 20 },
  7: { friction: 0.1 },
  10: { restitution: 0 },
});

/** Physics values a ground of `type` starts with, before a written `P` is applied (spec: S.P). */
export function groundConstructorPhysics(type) {
  return {
    dynamic: false, mass: 0, friction: DEFAULT_FRICTION, restitution: DEFAULT_RESTITUTION,
    rotation: 0, fixedRotation: false, linearDamping: 0, angularDamping: 0,
    ...TYPE_PHYSICS[type],
  };
}

/**
 * Collision group `c` -> collision category (docs/xml/grounds.md#collision): 0 -> 3 (4 for a cloud, T=8), 1 -> 3,
 * 2 -> 4, 3 -> 5, anything else (4, and the 5 water and cobweb always get) -> 0. Categories 3 / 4 / 5 / 0 are
 * "mice and objects" / "objects only" / "mice only" / "neither".
 */
export function decodeCollisionGroup(group, type = null) {
  let category;
  if (group === 0) category = type === 8 ? 4 : 3;
  else if (group === 1) category = 3;
  else if (group === 2) category = 4;
  else if (group === 3) category = 5;
  else category = 0;
  return { mice: category === 3 || category === 5, objects: category === 3 || category === 4, category };
}

/**
 * The replacements the game makes before the physics uses a ground's values (docs/xml/grounds.md#physics-p): a `NaN`
 * friction becomes 0.2, a `NaN` mass, angle or damping 0, and a negative friction or restitution 0.
 */
export function normalizeGroundPhysics(physics) {
  const p = { ...physics };
  if (Number.isNaN(p.friction)) p.friction = 0.2;
  if (Number.isNaN(p.mass)) p.mass = 0;
  if (Number.isNaN(p.rotation)) p.rotation = 0;
  if (Number.isNaN(p.linearDamping)) p.linearDamping = 0;
  if (Number.isNaN(p.angularDamping)) p.angularDamping = 0;
  if (p.friction < 0) p.friction = 0;
  if (p.restitution < 0) p.restitution = 0;
  return p;
}
