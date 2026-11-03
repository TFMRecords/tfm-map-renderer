// Lua modules whose map conventions the parser understands (docs/xml/modules.md). A module adds attributes the game itself
// does not read and decodes what they mean for that module; the result goes to `map.modules[name]`, apart from the core
// fields, and is computed for every map (a module says whether the map looks like one of its maps).
import { decodeParkour } from "./parkour.js";

/**
 * @typedef {object} MapModule
 * @property {string} name key in `map.modules`
 * @property {{object?: string[], decoration?: string[]}} attributes attribute names the module adds, per scope
 * @property {(nodes: {decorations: Array<{node: object, index: number}>, objects: Array<{node: object, index: number}>}) => object} decode
 */

/** @type {readonly MapModule[]} */
export const MAP_MODULES = Object.freeze([
  { name: "parkour", attributes: { object: ["stop", "size", "cheese"], decoration: ["size", "cheese"] }, decode: decodeParkour },
]);

/** Attribute names all modules add to a scope. */
export function moduleAttributes(scope) {
  return MAP_MODULES.flatMap((m) => m.attributes[scope] ?? []);
}

/** `{ [name]: decoded }` for every module. */
export function decodeModules(nodes) {
  return Object.fromEntries(MAP_MODULES.map((m) => [m.name, m.decode(nodes)]));
}
