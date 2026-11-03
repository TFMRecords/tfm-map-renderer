// The Lua module `parkour` (https://github.com/a801-luadev/parkour, modes/parkour/maps.lua): which checkpoints a map has
// and what each one does, read the way the module reads the XML. docs/xml/modules.md#parkour
import { attributeMap } from "../../xml/parse.js";

/** The end chair: decoration 19 whose `C` is exactly this colour (the module compares the whole value, case-sensitively). */
export const PARKOUR_CHAIR = Object.freeze({ type: 19, color: "329cd2" });
/** The shaman object that marks a checkpoint: the yellow nail. */
export const PARKOUR_CHECKPOINT_TYPE = 22;
/** The module reads the chair checkpoint this far above the chair. */
export const PARKOUR_CHAIR_OFFSET_Y = -40;

/**
 * Lua's `tonumber` of an attribute value: decimal or `0x` hex, surrounding spaces ignored; `null` when it is not a number
 * (an empty value is not). The module keeps a value that is not a number as text.
 */
export function luaNumber(value) {
  if (value == null) return null;
  const s = String(value).trim();
  const hex = /^([+-]?)0[xX]([0-9a-fA-F]+)$/.exec(s);
  if (hex) return (hex[1] === "-" ? -1 : 1) * Number.parseInt(hex[2], 16);
  if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return Number(s);
  return null;
}

// `cheese="0"` takes the cheese away, any other value (also an empty one) gives it.
function cheeseOf(a) {
  if (a.cheese === undefined) return null;
  return luaNumber(a.cheese) === 0 ? "remove" : "give";
}

/**
 * Decode the parkour data of a map.
 * @param {{decorations: Array<{node: object, index: number}>, objects: Array<{node: object, index: number}>}} nodes the
 *   element children of the decoration and object containers, with their index in `map.decorations` / `map.objects`
 * @returns {{detected: boolean, valid: boolean, problems: string[], chair: object|null, checkpoints: object[]}}
 */
export function decodeParkour({ decorations, objects }) {
  const problems = [];
  if (decorations.some(({ node }) => node.name === "T")) problems.push("hole");

  const checkpoints = [];
  const spawn = decorations.find(({ node }) => node.name === "DS");
  if (spawn) {
    const a = attributeMap(spawn.node);
    checkpoints.push({
      number: 1, kind: "spawn", decorationIndex: spawn.index, x: luaNumber(a.X), y: luaNumber(a.Y),
      sizeAttribute: luaNumber(a.size), size: luaNumber(a.size) ?? 1, stop: false, cheese: cheeseOf(a),
    });
  } else {
    problems.push("no-mouse-spawn");
  }

  for (const { node, index } of objects) {
    if (node.name !== "O") continue;
    const a = attributeMap(node);
    if (luaNumber(a.C) !== PARKOUR_CHECKPOINT_TYPE) continue;
    checkpoints.push({
      number: checkpoints.length + (spawn ? 1 : 2), kind: "nail", objectIndex: index, x: luaNumber(a.X), y: luaNumber(a.Y),
      sizeAttribute: luaNumber(a.size), size: null, stop: a.stop !== undefined, cheese: cheeseOf(a),
    });
  }
  const nails = checkpoints.filter((c) => c.kind === "nail").length;

  let chair = null;
  for (const { node, index } of decorations) {
    if (node.name !== "P") continue;
    const a = attributeMap(node);
    if (luaNumber(a.T) !== PARKOUR_CHAIR.type || a.C !== PARKOUR_CHAIR.color) continue;
    const x = luaNumber(a.X);
    const y = luaNumber(a.Y);
    chair = { decorationIndex: index, x, y, foreground: a.P === "1" || String(a.P ?? "").startsWith("1,") };
    checkpoints.push({
      number: checkpoints.length + (spawn ? 1 : 2), kind: "chair", decorationIndex: index, x,
      y: y == null ? null : y + PARKOUR_CHAIR_OFFSET_Y, sizeAttribute: null, size: 1, stop: false, cheese: null,
    });
    break;
  }
  if (!chair) problems.push("no-chair");
  if (nails === 0) problems.push("no-checkpoint");

  // A checkpoint without `size` keeps the size of the one before it.
  let previous = 1;
  for (const c of checkpoints) {
    if (c.size == null) c.size = c.sizeAttribute ?? previous;
    previous = c.size;
  }

  return { detected: chair != null, valid: problems.length === 0, problems, chair, checkpoints };
}
