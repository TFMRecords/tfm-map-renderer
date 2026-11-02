// The order in which the game stacks a map, bottom first, and what the renderer draws in each layer.
// docs/rendering.md shows the table (tools/gen-docs.mjs).

export const DRAW_ORDER = Object.freeze([
  { layer: "background", contents: "the room colour, the map background `F`, the background images `D` (first), then in map order every decoration, hole and cheese that is not in the foreground; `ARPS` images when they appear", verified: true },
  { layer: "built-in objects", contents: "only used by the game's built-in maps; empty for XML maps", verified: true },
  { layer: "grounds", contents: "joint lines that are not in the foreground, every ground (with the galaxy strip behind its ground), then the foreground holes (`D` on `T`)", verified: true },
  { layer: "mice", contents: "the mice and the arrow (object 0); the renderer draws no mice", verified: true },
  { layer: "objects", contents: "shaman objects, the foreground cheese (`D` on `F`)", verified: true },
  { layer: "top", contents: "foreground joint lines, foreground `d` images (first), foreground grounds (`N`; types 9, 15, 21), foreground decorations, `APS` images, the soulmate heart", verified: true },
  { layer: "screen", contents: "the `Ca` frame, over everything and never mirrored", verified: false },
]);
