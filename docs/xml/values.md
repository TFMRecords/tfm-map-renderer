# Values

How the game turns attribute strings into values, and what happens with malformed XML. The index is [`README.md`](README.md).

## Conversions

Attribute rules name these conversions. They differ in visible ways: `X="5.9"` is 5 on a ground (`int`) but a gravity of
`"5.9"` is 5.9 (`number`); an absent `number` is `NaN`, which the rule then replaces; `presence` makes `nosync=""` true while
`truthy` ignores an empty value.

<!-- BEGIN:coercions -->
| Name | Effect | Examples |
|---|---|---|
| `int` | Whole number. Leading and trailing spaces are ignored, `0x` hex and exponents are read, the fraction is cut off (towards zero) and the result wraps around at 32 bits. Anything that is not a number, an empty value and an absent attribute give 0. | `"5.9"` -> `5`, `"-5.9"` -> `-5`, `"0x10"` -> `16`, `"3e2"` -> `300`, `" 200"` -> `200`, `"4294967346"` -> `50`, `"12px"` -> `0`, `""` -> `0`, absent -> `0` |
| `number` | Decimal number. Spaces around it are ignored, `0x` hex, exponents and `Infinity` are read. An empty value is 0; an absent attribute or text that is not a number is `NaN` (the rule says what replaces it). `0b`, `0o` and `_` separators are not numbers. | `"2.5"` -> `2.5`, `"1e1"` -> `10`, `"0x10"` -> `16`, `""` -> `0`, `"1e1x"` -> `NaN`, `"0b11"` -> `NaN`, absent -> `NaN` |
| `number0` | `number`, with `NaN` replaced by 0. | `"2e3"` -> `2000`, `"bad"` -> `0`, absent -> `0` |
| `float` | The number at the start of the value, ignoring what follows it (`2.5x` is 2.5); `NaN` when the value does not start with a number. | `"2.5x"` -> `2.5`, `"bad"` -> `NaN` |
| `hex` | Hexadecimal number: leading spaces and a `0x` prefix are skipped, reading stops at the first character that is not a hex digit, and `NaN` when there is none (the rule says what replaces it). | `"ff00aa"` -> `16711850`, `"0xFF8080"` -> `16744576`, `" FF8080"` -> `16744576`, `"FF80zz"` -> `65408`, `"#FF8080"` -> `NaN` |
| `hexcolor` | `int` of `0x` followed by the value: a hex colour written without `#`. Anything that is not hex gives 0 (black). | `"112233"` -> `1122867`, `"ff0000"` -> `16711680`, `"zz"` -> `0` |
| `presence` | True when the attribute is written at all, even empty (`nosync=""`); the value is not read. | `""` -> `true`, `"0"` -> `true`, absent -> `false` |
| `truthy` | The attribute is used only when its value is not empty. `"0"` counts as a value. | `"0"` -> `true`, `""` -> `false`, absent -> `false` |
| `one` | True only when the value is exactly `1`. | `"1"` -> `true`, `"true"` -> `false`, absent -> `false` |
<!-- END:coercions -->

Notes:

- `presence` and `truthy` differ only for an empty value: `attr=""` is present but not truthy. `"0"` is both.
- An absent attribute in a `truthy` test counts as empty. (The game's code could in principle turn an absent value into the
  text `undefined`; the game's pictures show it does not: a decoration without `C` keeps its colours.)
- A field that a rule stores as a whole number keeps only the whole part, as `int` would: a `tint` that is `NaN` becomes 0.
- The number conversions were checked in the game with maps that place grounds by edge-case values (`0x96`, `3e2`,
  `4294967346`, `12px`, ...), tint grounds with edge-case colours and set the gravity to empty, missing and exponent values.

## Lists and fields

Many attributes are lists: the value is split on `,` (or `;` and then `,`), and each field is converted on its own. Field
numbers in the rules count from 1. A missing field is absent (so `number` gives `NaN`, `int` gives 0); extra fields are
ignored unless the rule says otherwise.

## Repeated attributes

When an element repeats an attribute (`X="100" X="300"`), the **last** value wins. Verified in the game. The parser reports
`duplicate-attribute`.

## Case

Element and attribute names are case-sensitive: `<t>` is not a hole and `x="400"` is not a position. Verified in the game.

## Entities and special markup

The in-game editor cannot save `&`, `!` or `?` (see [`limits-and-modes.md`](limits-and-modes.md)), so maps made with it have no
entities, comments, CDATA, processing instructions or declarations. The parser decodes the five predefined entities and
numeric references, keeps anything else as text, and drops comments and processing instructions.

## Malformed XML the game accepts

A few real maps are not well-formed XML, yet they run in the game. The parser is lenient by default and recovers exactly
these cases, each with a `lenient-recovery` diagnostic:

| Fault | Example | Recovery |
|---|---|---|
| stray quotes where an attribute name should start | `<P F="1" ''F="1"/>` | the quotes are skipped |
| a doubled `<` | `<JD/><<L/>` | the extra `<` is dropped |
| a garbled tag name | `<Jaaf43f,10,0.4" P1="40,339"/>` | the name is read up to the next space, `/` or `>` |

These three are taken from maps that run in the game; other malformed markup has not been tested. `lenient: false` makes the
parser strict (it then throws `XmlSyntaxError`).

## Text between tags

The game counts text between tags (only spaces are possible in an editor map) as children. A space where the game expects a
container moves every later container by one position, and a missing container makes the map fail to load. A space after the
last container that matters is harmless. The parser counts elements only by default; `structureMode: "client-raw"` counts text
the way the game does.

## When a map fails to load

The game then loads default map 0 instead. The parser does not fail: it reports a `client-error` diagnostic and sets
`source.clientLoads` to false. Causes: a missing zone or container, text in a container's position, a decoration `P` without
`P`, a `d` repeat without a `D` tuple, a joint-container `lua` before any joint, a particle `sp`/`acc` without its second group.

## Diagnostics

<!-- BEGIN:diagnostics -->
| Code | Severity | Layer | Meaning | In the game |
|---|---|---|---|---|
| `lenient-recovery` | info | xml | The parser (lenient by default; `lenient: false` is strict) recovered from markup a strict XML parser rejects, the way the game accepts it. `kind` is `stray-quotes` (`''` where an attribute name should start), `doubled-lt` (`<<`) or `garbled-tag-name` (a tag name containing `=`, quotes, `<` or `?`, read up to the next space, `/` or `>`). | Real maps with these three faults run in the game; other malformed markup has not been tested. |
| `duplicate-attribute` | info | xml | An element repeats an attribute name. The last value wins. | Verified: the last value is used. |
| `invalid-character-reference` | info | xml | `&#...;` with an out-of-range or malformed number; kept as text. | Cannot occur in an editor-made map (`&` is not allowed). |
| `unknown-entity` | info | xml | `&name;` other than amp, lt, gt, quot, apos; kept as text. | Cannot occur in an editor-made map (`&` is not allowed). |
| `multiple-root-elements` | info | xml | More than one top-level element; the first is the root. | The first node is the map. |
| `editor-disallowed-characters` | editor-limit | text | The text contains characters the editor does not allow; `characters` lists them. `$` only occurs in old maps and admin tools. | None: the game reads any text; only the editor refuses to save it. |
| `deprecated-attribute` | info | semantic | The settings carry `PNJ`, an attribute from 2012 that placed characters from the map. It no longer has an effect. | Not read. |
| `text-node-breaks-positional-slots` | client-error | slots | Text between tags (only a space is possible) takes a position, so the zone is not the second child of the root or has fewer than three children. | The map fails to load. Spaces after the last container that matters are harmless. |
| `legacy-text-node-shifts-root-slot` | client-quirk | slots | Text (usually formatting whitespace) sits among the first two children of the root. | The game counts text as a child, so it would read the settings or the zone from the wrong element. `structureMode: "client-raw"` reproduces this. |
| `legacy-text-node-shifts-zone-slot` | client-quirk | slots | Text sits among the first four children of the zone. | The same shift for the ground, decoration, object and joint containers. |
| `legacy-text-node-phantom-entries` | client-quirk | slots | A container (`S`, `D`, `O`, `L`) has text children. | Each text node becomes an empty ground, decoration or object. |
| `joint-unknown-tag-applies-to-previous` | client-quirk | semantic | A child of `L` is not `JD`, `JP`, `JPL` or `JR` but carries `c` and/or `lua`. | The style or Lua id is applied to the previous joint; `joint.staleCarry.targetIndex` names it. |
| `joint-lua-before-any-joint` | client-error | semantic | A child of `L` that is not a joint carries `lua` before any joint. | The map fails to load. |
| `zone-missing` | client-error | structure | The root has no second element. | The map fails to load (it is not an empty map). |
| `zone-container-missing` | client-error | structure | The zone has fewer than three element children (the ground, decoration or object container is missing). | The map fails to load. |
| `decoration-p-attribute-missing` | client-error | semantic | A decoration `P` has no `P` attribute. | The map fails to load. |
| `particle-group-missing` | client-error | semantic | A particle `sp` or `acc` of two characters or more has no second `;` group. | The map fails to load. |
| `d-repeat-without-d-tuple` | client-error | semantic | `d` repeats an image but `D` has no `url,x,y,...` tuple (it is absent, `#...`, or a single URL). | The map fails to load: the repeat offset comes from a `D` tuple that does not exist. |
<!-- END:diagnostics -->
