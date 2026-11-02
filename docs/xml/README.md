# Transformice map XML reference

What the Transformice game does with a map's XML: every element and attribute, how its value is read, what it is for, and
what is still unknown. It describes the **format and the game**; how this project's parser exposes the values is in the
*Parser fields* table of each page.

The tables on these pages are generated from [`src/tfm/spec/`](../../src/tfm/spec/) by `npm run docs:xml`
(`npm test` fails when they are stale), and every example in them is run by the tests. The prose around the tables is
hand-written. [`spec.json`](spec.json) holds the same data for other tools.

## Pages

| Page | Content |
|---|---|
| [`values.md`](values.md) | how attribute strings become numbers, flags and lists; malformed and repeated attributes; diagnostics |
| [`settings.md`](settings.md) | the settings element `P` |
| [`grounds.md`](grounds.md) | grounds `S`: ground types, physics, collision, honey, area physics |
| [`decorations.md`](decorations.md) | the children of `D`: holes, cheese, spawns, decorations |
| [`objects.md`](objects.md) | shaman objects `O`: types, skins, nails, ghosts |
| [`joints.md`](joints.md) | joints in `L` |
| [`particles.md`](particles.md) | particles |
| [`images.md`](images.md) | `D`, `d`, `APS`, `ARPS`, `IP`, ground `i`: syntax and URL rules |
| [`limits-and-modes.md`](limits-and-modes.md) | editor and game limits, restricted maps, mirroring, minimalist mode |

How the renderer draws a map, and what has been compared with the game, is in [`../rendering.md`](../rendering.md).

## The document

```xml
<C>
  <P L="800" H="400"/>                               settings: first child of the root
  <Z>                                                zone: second child of the root
    <S> <S T="0" X="400" Y="380" L="800" H="40"/> </S>   grounds: first zone child
    <D> <T X="100" Y="340"/> <F X="700" Y="340"/> </D>   decorations: second zone child
    <O> <O C="1" X="400" Y="200"/> </O>                  shaman objects: third zone child
    <L> <JD M1="0" M2="1"/> </L>                         joints: fourth zone child, only when it is named L
    <particles> <p id="1"/> </particles>                 particles: a zone child named particles (the last one)
  </Z>
</C>
```

The game finds most parts by **position**, not by name: the root, the settings, the zone, and the ground, decoration and object
containers can have any name (`<C>`, `<P>`, `<Z>`, `<S>`, `<D>`, `<O>` are the convention). Names matter for the joint container
(`L`), the `particles` element, and the children of `D` and `L`. Grounds and objects can have any element name. Names are
case-sensitive.

A minimal map that loads without diagnostics:

```xml
<C><P L="800" H="400" F="0"/><Z><S><S T="0" X="400" Y="380" L="800" H="40" P="0,0,0.3,0.2,0,0,0,0"/></S><D><DS X="100" Y="340"/><DC X="700" Y="340"/><F X="700" Y="340"/><T X="100" Y="340"/></D><O/><L/></Z></C>
```

Coordinates are in pixels: origin at the top left corner, X to the right, Y downwards. The default map is 800 x 400.

## Reading the tables

Each page has two generated tables per element:

- **Attributes**: *Read as* gives the value's type, the default when the attribute is absent, and the rule the game follows.
  Rules name the conversions of [`values.md`](values.md) in backticks (`int`, `number`, `presence`, ...).
  *Meaning* says what the attribute is for.
- **Parser fields**: the spec id, where this project's parser puts the value, and examples that the tests parse.

The **spec id** of an attribute is its element and name: `P.G` (settings `G`), `S.P` (ground `P`), `D/P.C` (`C` on a decoration
`P`), `D/*.X` (any decoration child), `L/JD.HZ` (`HZ` on a distance joint), `particles/*.sp`. Code comments cite attributes as
`// spec: S.P`.

## Status

| Status | Meaning |
|---|---|
| verified | how the game reads the value is known, and what it does with it is established (checked in the game, or known from how the game is built) |
| **unverified** | the reading is known, but something about the attribute is guessed or unknown; the note says what |
| extension | not read by the game; a convention of Lua modules |

<!-- BEGIN:status-summary -->
| Status | Attributes |
|---|---|
| verified | 65 |
| unverified | 29 |
| extension | 2 |
| **total** | **96** |
<!-- END:status-summary -->

### Unverified attributes

<!-- BEGIN:unverified -->
- [`P.aie`](settings.md#attr-P-aie): What the game does with the flag has not been checked; the meaning is the community documentation's.
- [`P.N`](settings.md#attr-P-N): Whether the first number is a radius or a diameter, and what the second number selects, have not been checked in the game.
- [`P.C`](settings.md#attr-P-C): The effect has not been checked in the game; the meaning is the community documentation's.
- [`P.P`](settings.md#attr-P-P): The effect has not been checked in the game; the meaning is the community documentation's.
- [`S.target`](grounds.md#attr-S-target): The game stores the value; what uses it has not been seen.
- [`S.c`](grounds.md#collision): The collision masks are verified; which mask stands for mice and which for shaman objects is inferred.
- [`S.inputSpeedBonus`](grounds.md#attr-S-inputSpeedBonus): What the game does with it has not been seen.
- [`S.outputSpeedBonus`](grounds.md#attr-S-outputSpeedBonus): What the game does with it has not been seen.
- [`S.invertOutputPoint`](grounds.md#attr-S-invertOutputPoint): The game stores the flag; what uses it has not been seen.
- [`S.addInputGroundSpeed`](grounds.md#attr-S-addInputGroundSpeed): The game stores the flag; what uses it has not been seen.
- [`S.grav`](grounds.md#attr-S-grav): Follows from how the game builds a ground; not checked in the game.
- [`S.col`](grounds.md#attr-S-col): What the physics does with the flag has not been seen.
- [`S.contact`](grounds.md#attr-S-contact): What the physics does with it has not been seen.
- [`S.friction`](grounds.md#honey): The sticky and slippery reading is a third-party editor's; the game's honey code has not been seen.
- [`S.P`](grounds.md#physics-p): That fields 3 and 4 are friction and restitution is inferred from three agreeing sources; the physics code that reads them has not been seen.
- [`S.archAcc`](grounds.md#attr-S-archAcc): The unit and the effect in the game are unknown.
- [`S.archMax`](grounds.md#attr-S-archMax): The unit and the effect in the game are unknown.
- [`S.archCheeseMax`](grounds.md#attr-S-archCheeseMax): The unit and the effect in the game are unknown.
- [`S.linDampAcc`](grounds.md#attr-S-linDampAcc): The unit and the effect in the game are unknown.
- [`S.linDampMax`](grounds.md#attr-S-linDampMax): The unit and the effect in the game are unknown.
- [`S.angDampAcc`](grounds.md#attr-S-angDampAcc): The unit and the effect in the game are unknown.
- [`S.angDampMax`](grounds.md#attr-S-angDampMax): The unit and the effect in the game are unknown.
- [`D/P.P`](decorations.md#decorations-p): The random flip follows the game's code; being random, it cannot be compared with the game.
- [`L/JD.HZ`](joints.md#attr-L-JD-HZ): Sources disagree on the name: a third-party editor calls it frequency, the community documentation damping or tautness.
- [`L/JD.AMP`](joints.md#attr-L-JD-AMP): Sources disagree on the name: a third-party editor calls it damping, the community documentation elasticity.
- [`L/*.c`](joints.md#style-c): That a child which is not a joint styles the previous joint follows the game's code; it has not been checked in the game.
- [`L/*.lua`](joints.md#attr-L-any-lua): That a child which is not a joint changes the previous joint follows the game's code; it has not been checked in the game.
- [`particles/*.sp`](particles.md): The load failure follows the game's code; no map with particles has been checked in the game.
- [`particles/*.acc`](particles.md): The load failure follows the game's code; no map with particles has been checked in the game.
<!-- END:unverified -->

## Sources

The rules come from how the game client reads a map, checked against the game wherever the result is visible: maps made
for one question each (`test/maps/`) were loaded in the game and in the in-game editor and compared with this project's
renderer. Names and meanings also draw on the community XML documentation (Atelier 801 forums) and on the third-party
editor Miceditor; where those sources disagree with the game, the game wins and the disagreement is noted. This project is
not affiliated with Atelier 801.
