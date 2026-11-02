// The map XML specification as data. Everything in docs/xml/ that is a table is generated from these modules
// (`npm run docs:xml`); docs/xml/spec.json holds the same data for other tools.
export { ATTRIBUTES, scopeOf, idOf, anchorOf, docOf, findAttribute, exampleXml, getPath, PAGE_OF_SCOPE } from "./attributes.js";
export { COERCIONS, COERCION_NAMES } from "./values.js";
export { GROUND_TYPES, UNKNOWN_GROUND_TYPE, DEFAULT_GROUND_PHYSICS, GROUND_SIZE, AREA_DEFAULTS, COLLISION_PRESETS, DYNAMIC_GROUND_DENSITY, HONEY_DEFAULT } from "./ground-types.js";
export {
  FILTERED_TYPES, CREATED_TYPES, NAIL_TYPES, WORLD_NAIL_TYPES, ROTATING_NAIL_TYPES, ROTATING_NAIL_LIMIT, NO_PICTURE_TYPES,
  DEFILANTE_MARKERS, SPECIAL_PICTURES, splitObjectType, GHOST_TRANSFORM,
} from "./objects.js";
export { DECORATION_TAGS, HOLE_GLOWS, MINIMALIST_DECORATIONS, INTERACTIVE_DECORATIONS, EDITOR_BACKDROP_DECORATIONS, EVENT_CHEESE_SUFFIXES } from "./decorations.js";
export { EDITOR_CHARACTERS, MAP_SIZE, RESTRICTED_LIMITS, ALWAYS_LIMITS, EDITOR_OBJECT_DRAW_LIMIT } from "./limits.js";
export { DIAGNOSTICS } from "./diagnostics.js";
export { DRAW_ORDER } from "./draw-order.js";
