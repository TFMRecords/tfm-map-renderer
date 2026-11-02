# Joints `L`

Children of the fourth zone container, and only when that container is named `L`. The index is [`README.md`](README.md);
conversions are in [`values.md`](values.md).

| Tag | Joint |
|---|---|
| `JD` | distance joint (a spring when `HZ` is set) |
| `JP` | prismatic joint (slides along `AXIS`) |
| `JPL` | pulley |
| `JR` | revolute joint (turns around a point) |

Which attributes each kind reads:

| Attribute | `JD` | `JP` | `JPL` | `JR` |
|---|---|---|---|---|
| `M1`, `M2`, `P1` | yes | yes | yes | yes |
| `P2` | yes | | yes | |
| `P3`, `P4`, `R` | | | yes | |
| `HZ`, `AMP` | yes | | | |
| `AXIS`, `A` | | yes | | |
| `LIM1`, `LIM2`, `MV` | | yes | | yes |
| `c`, `lua` | any child of `L` | | | |

## Attributes

<!-- BEGIN:attrs-joint -->
| Attribute | Tags | Read as | Meaning | Status |
|---|---|---|---|---|
| <a id="attr-L-any-M1"></a>`M1` | `JD`, `JP`, `JPL`, `JR` | `int`. Absent: 0. | First joined ground: its index in the map's ground list. | verified |
| <a id="attr-L-any-M2"></a>`M2` | `JD`, `JP`, `JPL`, `JR` | `int`. Absent: 0. | Second joined ground. | verified |
| <a id="attr-L-any-P1"></a>`P1` | `JD`, `JP`, `JPL`, `JR` | Split on `,`, each field `int`. Absent: none (a default anchor, see joints). | First anchor point (x,y). | verified |
| <a id="attr-L-JD-P2"></a>`P2` | `JD`, `JPL` | Like `P1`. Absent: none (a default anchor, see joints). | Second anchor point (x,y). | verified |
| <a id="attr-L-JD-HZ"></a>`HZ` | `JD` | `number0`. Absent: 0. | Spring frequency of a distance joint. | **unverified**: Sources disagree on the name: a third-party editor calls it frequency, the community documentation damping or tautness. |
| <a id="attr-L-JD-AMP"></a>`AMP` | `JD` | `number0`. Absent: 0. | Damping of a distance joint. | **unverified**: Sources disagree on the name: a third-party editor calls it damping, the community documentation elasticity. |
| <a id="attr-L-JP-AXIS"></a>`AXIS` | `JP` | Split on `,`, two `int` fields; x is negated in a mirrored room. Absent: none. | Axis of a prismatic joint. | verified |
| <a id="attr-L-JP-A"></a>`A` | `JP` | `number0`; negated in a mirrored room. Absent: 0. | Angle of a prismatic joint. | verified |
| <a id="attr-L-JP-LIM1"></a>`LIM1` | `JP`, `JR` | `number`. Absent: none. | First limit. | verified |
| <a id="attr-L-JP-LIM2"></a>`LIM2` | `JP`, `JR` | `number`. Absent: none. | Second limit. | verified |
| <a id="attr-L-JP-MV"></a>`MV` | `JP`, `JR` | `truthy`. Split on `,`: two `number` fields, power and speed; a `JR` negates the speed in a mirrored room. Absent: none. | Motor power and speed. | verified |
| <a id="attr-L-JPL-P3"></a>`P3` | `JPL` | Like `P1`. Absent: none. | First ground anchor of a pulley. | verified |
| <a id="attr-L-JPL-P4"></a>`P4` | `JPL` | Like `P1`. Absent: none. | Second ground anchor of a pulley. | verified |
| <a id="attr-L-JPL-R"></a>`R` | `JPL` | `number`; `NaN` becomes 1. Absent: 1. | Pulley ratio. | verified |
| <a id="attr-L-any-c"></a>`c` | any | `truthy`. Split on `,`: colour `hexcolor`, thickness `int` (default 1), alpha `number0` (default 1), foreground is `one` (default no). Each field is read only when the value has that many. On a child of `L` that is not a joint it applies to the previous joint. Absent: none (the joint is invisible). | Look of the joint line: colour, thickness, alpha 0 to 1, foreground flag. A joint without it is invisible. | **unverified**: That a child which is not a joint styles the previous joint follows the game's code; it has not been checked in the game. |
| <a id="attr-L-any-lua"></a>`lua` | any | `int`, whenever the attribute is present. On a child of `L` that is not a joint it applies to the previous joint; before any joint it makes the map fail to load. Absent: 0. | Lua id of the joint. | **unverified**: That a child which is not a joint changes the previous joint follows the game's code; it has not been checked in the game. |
<!-- END:attrs-joint -->

## Parser fields

<!-- BEGIN:fields-joint -->
| Spec id | Type | Parser field | Examples (checked by the tests) |
|---|---|---|---|
| `L/*.M1` | `int` | `joints[].m1` | `M1="3.9"` -> `joints[0].m1 = 3` |
| `L/*.M2` | `int` | `joints[].m2` | `M2="4"` -> `joints[0].m2 = 4` |
| `L/*.P1` | `point` | `joints[].p1` | `P1="10.5,20"` -> `joints[0].p1.x = 10` |
| `L/JD.P2` | `point` | `joints[].p2` | `P2="1,2"` -> `joints[0].p2.y = 2` |
| `L/JD.HZ` | `number` | `joints[].frequency` (alias hz) | `HZ="bad"` -> `joints[0].frequency = 0`; `HZ="3"` -> `joints[0].hz = 3` |
| `L/JD.AMP` | `number` | `joints[].damping` (alias amplitude) | `AMP="2e3"` -> `joints[0].damping = 2000`; `AMP="2.5"` -> `joints[0].amplitude = 2.5` |
| `L/JP.AXIS` | `point` | `joints[].axis` | `AXIS="1.9,0"` -> `joints[0].axis.x = 1` |
| `L/JP.A` | `number` | `joints[].angle` | `A="1.0472"` -> `joints[0].angle = 1.0472` |
| `L/JP.LIM1` | `number` | `joints[].lim1` | `LIM1="-2"` -> `joints[0].lim1 = -2` |
| `L/JP.LIM2` | `number` | `joints[].lim2` | `LIM2="3"` -> `joints[0].lim2 = 3` |
| `L/JP.MV` | `list<number>` | `joints[].motor` | `MV="5,-2"` -> `joints[0].motor.speed = -2` |
| `L/JPL.P3` | `point` | `joints[].p3` | `P3="7,8"` -> `joints[0].p3.x = 7` |
| `L/JPL.P4` | `point` | `joints[].p4` | `P4="9,10"` -> `joints[0].p4.y = 10` |
| `L/JPL.R` | `number` | `joints[].ratio` | `R="bad"` -> `joints[0].ratio = 1` |
| `L/*.c` | `custom` | `joints[].style` | `c="ff0000,3,.25,1"` -> `joints[0].style.thickness = 3` |
| `L/*.lua` | `int` | `joints[].lua` (raw string), `joints[].clientLuaId` | `lua="12.9"` -> `joints[0].clientLuaId = 12` |
<!-- END:fields-joint -->

## Grounds

`M1` and `M2` are indexes into the map's ground list, in XML order, after the limits of a restricted map. A joint whose ground
does not exist is not made.

## Anchors

Points are `x,y` in map pixels (each `int`); the physics divides them by 30 and a mirrored room mirrors them. A missing anchor is
the centre of a joined ground: a missing `P1` is `M1`'s centre and a missing `P2` `M2`'s; a `JP` uses `M1`'s centre and a `JR`
`M2`'s (inferred from how the game builds the joints). A pulley without `P3` or `P4` is not made.

## Style `c`

`c="colour,thickness,alpha,foreground"` draws the joint as a line between its anchors (a pulley through its two ground
anchors: `P1`, `P3`, `P4`, `P2`). Each field is read only when present: the colour defaults to `#009D9D`, the thickness to 1,
the alpha to 1, the foreground to no. Thickness 0 is a hairline (one screen pixel); the line goes under the grounds, or with
the fourth field 1 into the top layer, under the foreground grounds, decorations and images. A joint without `c` is invisible;
`JP` and `JR` joints have two coinciding anchors and draw nothing. Verified in the game. A joint that belongs to Lua (`lua` set)
is not drawn.

## Children that are not joints

A child of `L` that is not `JD`, `JP`, `JPL` or `JR` makes no joint, but its `c` and `lua` are applied to the **previous** joint,
and a `lua` before any joint makes the map fail to load (the parser reports `joint-unknown-tag-applies-to-previous` and
`joint-lua-before-any-joint`). This follows from how the game reads the container and has not been checked in the game.
Real maps contain such children: curve and layer markers of map editors (`VC`, `VL`, `VDEL`) and an empty `<L/>` at the end.
