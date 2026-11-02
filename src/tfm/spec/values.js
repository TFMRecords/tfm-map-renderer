// How the game turns an attribute string into a value. Attribute rules (attributes.js) refer to these by name, in
// backticks (`int`, `number`, ...); docs/xml/values.md shows the table and test/spec.test.js runs every example against
// the parser's own conversion functions (src/tfm/codecs.js).

/**
 * @typedef {object} Coercion
 * @property {string} name   the name rules use
 * @property {string} effect what it does, in plain language
 * @property {Array<[string|undefined, unknown]>} examples [attribute value (undefined = attribute absent), result]
 */

/** @type {Coercion[]} */
export const COERCIONS = [
  {
    name: "int",
    effect: "Whole number. Leading and trailing spaces are ignored, `0x` hex and exponents are read, the fraction is cut off (towards zero) and the result wraps around at 32 bits. Anything that is not a number, an empty value and an absent attribute give 0.",
    examples: [["5.9", 5], ["-5.9", -5], ["0x10", 16], ["3e2", 300], [" 200", 200], ["4294967346", 50], ["12px", 0], ["", 0], [undefined, 0]],
  },
  {
    name: "number",
    effect: "Decimal number. Spaces around it are ignored, `0x` hex, exponents and `Infinity` are read. An empty value is 0; an absent attribute or text that is not a number is `NaN` (the rule says what replaces it). `0b`, `0o` and `_` separators are not numbers.",
    examples: [["2.5", 2.5], ["1e1", 10], ["0x10", 16], ["", 0], ["1e1x", NaN], ["0b11", NaN], [undefined, NaN]],
  },
  {
    name: "number0",
    effect: "`number`, with `NaN` replaced by 0.",
    examples: [["2e3", 2000], ["bad", 0], [undefined, 0]],
  },
  {
    name: "float",
    effect: "The number at the start of the value, ignoring what follows it (`2.5x` is 2.5); `NaN` when the value does not start with a number.",
    examples: [["2.5x", 2.5], ["bad", NaN]],
  },
  {
    name: "hex",
    effect: "Hexadecimal number: leading spaces and a `0x` prefix are skipped, reading stops at the first character that is not a hex digit, and `NaN` when there is none (the rule says what replaces it).",
    examples: [["ff00aa", 0xff00aa], ["0xFF8080", 0xff8080], [" FF8080", 0xff8080], ["FF80zz", 0xff80], ["#FF8080", NaN]],
  },
  {
    name: "hexcolor",
    effect: "`int` of `0x` followed by the value: a hex colour written without `#`. Anything that is not hex gives 0 (black).",
    examples: [["112233", 0x112233], ["ff0000", 0xff0000], ["zz", 0]],
  },
  {
    name: "presence",
    effect: "True when the attribute is written at all, even empty (`nosync=\"\"`); the value is not read.",
    examples: [["", true], ["0", true], [undefined, false]],
  },
  {
    name: "truthy",
    effect: "The attribute is used only when its value is not empty. `\"0\"` counts as a value.",
    examples: [["0", true], ["", false], [undefined, false]],
  },
  {
    name: "one",
    effect: "True only when the value is exactly `1`.",
    examples: [["1", true], ["true", false], [undefined, false]],
  },
];

export const COERCION_NAMES = Object.freeze(COERCIONS.map((c) => c.name));
