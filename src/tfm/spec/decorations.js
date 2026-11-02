// Children of the decoration container (`<D>`): what each tag is, and the decoration ids with special handling.
// docs/xml/decorations.md shows the table (tools/gen-docs.mjs).

/** Tags with a role. Names are case-sensitive; any other tag is kept with its X and Y only. */
export const DECORATION_TAGS = Object.freeze([
  Object.freeze({ tag: "T", role: "hole", reads: ["X", "Y", "D", "CT"], picture: "`$Trou_Souris`" }),
  Object.freeze({ tag: "F", role: "cheese", reads: ["X", "Y", "D"], picture: "`$Fromage` (see below)" }),
  Object.freeze({ tag: "DS", role: "mouse-spawn", reads: ["X", "Y"], picture: "none in the game" }),
  Object.freeze({ tag: "DC", role: "shaman-spawn", reads: ["X", "Y"], picture: "none in the game" }),
  Object.freeze({ tag: "DC2", role: "dual-shaman-spawn", reads: ["X", "Y"], picture: "none in the game" }),
  Object.freeze({ tag: "P", role: "decoration", reads: ["X", "Y", "T", "P", "C"], picture: "`$P_<T>`" }),
]);

/** Glow of a hole per `CT`: Flash glow, colour, blur 5 x 5, strength 3, quality 3. */
export const HOLE_GLOWS = Object.freeze({ 1: 0x98e2eb, 2: 0xfeb1fc });

/** Decorations still drawn in minimalist mode (every other decoration is hidden). */
export const MINIMALIST_DECORATIONS = Object.freeze([89, 90, 131]);

/** Interactive decorations: the game keeps them as live clips (the renderer draws their first frame). 89 and 90 are buttons. */
export const INTERACTIVE_DECORATIONS = Object.freeze([15, 16, 17, 19, 25, 67, 68, 89, 90, 104, 105, 131, 158, 166, 167]);

/** Decorations the in-game editor always draws behind everything (the game does not). */
export const EDITOR_BACKDROP_DECORATIONS = Object.freeze([34, 117]);

/** Cheese suffixes events set at run time (picture `$Fromage<suffix>`); the normal game has none. */
export const EVENT_CHEESE_SUFFIXES = Object.freeze(["Cahier", "Citrouille", "Epice", "Glace", "Herbe", "Nounours", "Or", "PasFrais", "Saumon"]);
