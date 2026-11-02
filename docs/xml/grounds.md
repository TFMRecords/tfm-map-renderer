# Grounds `S`

Children of the first zone container, conventionally `<S><S .../></S>`. The element name of a ground is not read. The index is
[`README.md`](README.md); conversions are in [`values.md`](values.md).

## Attributes

<!-- BEGIN:attrs-ground -->
| Attribute | Read as | Meaning | Status |
|---|---|---|---|
| <a id="attr-S-T"></a>`T` | `int`. Absent: 0. | Ground type, 0 to 21 (see ground types). Other values are drawn like wood and get the default physics. | verified |
| <a id="attr-S-X"></a>`X` | `int`. Absent: 0. | Horizontal position in pixels; the ground is centred on (X, Y). | verified |
| <a id="attr-S-Y"></a>`Y` | `int`. Absent: 0. | Vertical position in pixels. | verified |
| <a id="attr-S-L"></a>`L` | `int`, then kept between 10 and 4000 (`derived.width`; `width` is the written value). Absent: 10. | Width in pixels; for a circle (13) the radius. | verified |
| <a id="attr-S-H"></a>`H` | `int`, then kept between 10 and 4000 like `L`. Absent: 10. | Height in pixels; a circle ignores it. | verified |
| <a id="attr-S-name"></a>`name` | The raw value. Absent: none. | Name the ground is registered under; a galaxy ground (21) is found by this name through `target`. | verified |
| <a id="attr-S-target"></a>`target` | The raw value. Absent: none. | Name of the ground a galaxy ground leads to. | **unverified**: The game stores the value; what uses it has not been seen. |
| <a id="attr-S-nosync"></a>`nosync` | `presence`. Absent: false. | Disables synchronisation of a dynamic ground with the room. | verified |
| <a id="attr-S-c"></a>`c` | `int`; water (9) and cobweb (15) always use 5. Groups 0 and 1 collide with mice and objects (a cloud, 8, with group 0: objects only), 2 with objects only, 3 with mice only, anything else with nothing. Absent: 0. | Collision group: what the ground stops. The community documentation numbers the groups differently (1 all, 2 objects and grounds, 3 mice and objects, 4 nothing). | **unverified**: The collision masks are verified; which mask stands for mice and which for shaman objects is inferred. |
| <a id="attr-S-v"></a>`v` | `int`. Absent: 0. | Time in milliseconds after which the ground disappears. | verified |
| <a id="attr-S-m"></a>`m` | `presence`. Absent: false. | Hides the ground's picture; its physics stays. | verified |
| <a id="attr-S-inputSpeedBonus"></a>`inputSpeedBonus` | `float`, whenever the attribute is present; `NaN` becomes 0. Absent: none. | Speed bonus of a galaxy ground. | **unverified**: What the game does with it has not been seen. |
| <a id="attr-S-outputSpeedBonus"></a>`outputSpeedBonus` | `float`, whenever the attribute is present; `NaN` becomes 0. Absent: none. | Speed bonus of a galaxy ground. | **unverified**: What the game does with it has not been seen. |
| <a id="attr-S-invertOutputPoint"></a>`invertOutputPoint` | `presence`. Absent: false. | Flag of a galaxy ground. | **unverified**: The game stores the flag; what uses it has not been seen. |
| <a id="attr-S-addInputGroundSpeed"></a>`addInputGroundSpeed` | `presence`. Absent: false. | Flag of a galaxy ground. | **unverified**: The game stores the flag; what uses it has not been seen. |
| <a id="attr-S-tint"></a>`tint` | `hex`, whenever the attribute is present; `NaN` becomes 0 and the value is kept as a 32-bit integer. Absent: 808080. | Colour transform of the ground's picture: each channel is multiplied by the tint's channel / 128, so `808080` changes nothing. | verified |
| <a id="attr-S-grav"></a>`grav` | `number`, whenever the attribute is present. Absent: 1. | Multiplies the gravity applied to the ground's own body. Only a dynamic ground has a body, so it does nothing on a static ground; it does not change gravity for mice. | **unverified**: Follows from how the game builds a ground; not checked in the game. |
| <a id="attr-S-col"></a>`col` | `presence`. Absent: false. | Touch-collision flag on the ground's shapes. | **unverified**: What the physics does with the flag has not been seen. |
| <a id="attr-S-lua"></a>`lua` | `number`, whenever the attribute is present (`NaN` stays `NaN`). Absent: none. | Id that identifies the ground in Lua. | verified |
| <a id="attr-S-contact"></a>`contact` | `int`, whenever the attribute is present. Absent: none. | Contact number copied to the ground's shapes. | **unverified**: What the physics does with it has not been seen. |
| <a id="attr-S-friction"></a>`friction` | `truthy`. Split on `,`: two `number` fields (`NaN` when missing). When the first is not 0 the ground is honey with these two numbers. Absent: none (honey, type 20: `20,4`). | Not the friction coefficient (that is field 3 of `P`): makes the ground honey. Sticky when the first number is 0 or more (strength 5 x first), slippery otherwise (strength -first); duration first / second. | **unverified**: The sticky and slippery reading is a third-party editor's; the game's honey code has not been seen. |
| <a id="attr-S-i"></a>`i` | Whenever the attribute is present: split on `,`, at least 3 fields: x = `int` of field 1, y = `int` of field 2, URL = field 3 (a URL containing a comma is cut). Absent: none. | Image that replaces the ground's picture, placed at (x, y) from the ground's top left corner. Off in restricted maps. | verified |
| <a id="attr-S-P"></a>`P` | `truthy`; ignored for water (9). Split on `,`: field 1 is `one` (dynamic), 2 mass, 3 friction, 4 restitution, 5 angle in degrees, 6 is `one` (fixed rotation), 7 linear damping, 8 angular damping. The numbers are `number`, `NaN` when missing. Absent: the type's physics (see ground types). | Physics: dynamic, mass, friction, restitution, angle, fixed rotation, linear and angular damping. Mass, fixed rotation and the dampings only act on dynamic grounds; a negative mass makes a dynamic ground immovable. | **unverified**: That fields 3 and 4 are friction and restitution is inferred from three agreeing sources; the physics code that reads them has not been seen. |
| <a id="attr-S-o"></a>`o` | `truthy`, then `hexcolor`. Absent: none (white). | Colour of a rectangle (12) or circle (13) ground; other types ignore it. Without it those two are white. | verified |
| <a id="attr-S-N"></a>`N` | `presence`. Absent: false. | Draws the ground in front of the mice. Water, cobweb and galaxy (9, 15, 21) are always in front. | verified |
| <a id="attr-S-archAcc"></a>`archAcc` | Water (`T=9`) and cobweb (`T=15`) only: `truthy`, then `number`. Other types ignore it. Absent: per type (see ground types). | Area physics value of water or cobweb. | **unverified**: The unit and the effect in the game are unknown. |
| <a id="attr-S-archMax"></a>`archMax` | Water (`T=9`) and cobweb (`T=15`) only: `truthy`, then `number`. Other types ignore it. Absent: per type (see ground types). | Area physics value of water or cobweb. | **unverified**: The unit and the effect in the game are unknown. |
| <a id="attr-S-archCheeseMax"></a>`archCheeseMax` | Water (`T=9`) and cobweb (`T=15`) only: `truthy`, then `number`. Other types ignore it. Absent: per type (see ground types). | Area physics value of water or cobweb. | **unverified**: The unit and the effect in the game are unknown. |
| <a id="attr-S-linDampAcc"></a>`linDampAcc` | Water (`T=9`) and cobweb (`T=15`) only: `truthy`, then `number`. Other types ignore it. Absent: per type (see ground types). | Area linear-damping value of water or cobweb. | **unverified**: The unit and the effect in the game are unknown. |
| <a id="attr-S-linDampMax"></a>`linDampMax` | Water (`T=9`) and cobweb (`T=15`) only: `truthy`, then `number`. Other types ignore it. Absent: per type (see ground types). | Area linear-damping value of water or cobweb. | **unverified**: The unit and the effect in the game are unknown. |
| <a id="attr-S-angDampAcc"></a>`angDampAcc` | Water (`T=9`) and cobweb (`T=15`) only: `truthy`, then `number`. Other types ignore it. Absent: per type (see ground types). | Area angular-damping value of water or cobweb. | **unverified**: The unit and the effect in the game are unknown. |
| <a id="attr-S-angDampMax"></a>`angDampMax` | Water (`T=9`) and cobweb (`T=15`) only: `truthy`, then `number`. Other types ignore it. Absent: per type (see ground types). | Area angular-damping value of water or cobweb. | **unverified**: The unit and the effect in the game are unknown. |
<!-- END:attrs-ground -->

## Parser fields

<!-- BEGIN:fields-ground -->
| Spec id | Type | Parser field | Examples (checked by the tests) |
|---|---|---|---|
| `S.T` | `int` | `grounds[].type` | `T="12.9"` -> `grounds[0].type = 12` |
| `S.X` | `int` | `grounds[].x` | `X="-5.5"` -> `grounds[0].x = -5` |
| `S.Y` | `int` | `grounds[].y` | `Y="7"` -> `grounds[0].y = 7` |
| `S.L` | `int` | `grounds[].width`, `grounds[].derived.width` | `L="300"` -> `grounds[0].width = 300`; `L="5"` -> `grounds[0].derived.width = 10`; `L="9000"` -> `grounds[0].derived.width = 4000`; `L="9000"` -> `grounds[0].width = 9000` |
| `S.H` | `int` | `grounds[].height`, `grounds[].derived.height` | `H="20"` -> `grounds[0].height = 20`; `H="0"` -> `grounds[0].derived.height = 10`; `H="4000"` -> `grounds[0].derived.height = 4000` |
| `S.name` | `string` | `grounds[].name` | `name="door"` -> `grounds[0].name = "door"` |
| `S.target` | `string` | `grounds[].target` | `target="door"` -> `grounds[0].target = "door"` |
| `S.nosync` | `bool` | `grounds[].nosync` | `nosync=""` -> `grounds[0].nosync = true` |
| `S.c` | `int` | `grounds[].collisionGroup` (alias colorCode), `grounds[].derived.collisionGroup`, `grounds[].derived.collision` | `c="3"` -> `grounds[0].collisionGroup = 3`; `c="2"` -> `grounds[0].derived.collision = {"mice":false,"objects":true,"category":4}`; `c="4"` -> `grounds[0].derived.collision = {"mice":false,"objects":false,"category":0}`; `T="8"` -> `grounds[0].derived.collision = {"mice":false,"objects":true,"category":4}`; `T="8" c="1"` -> `grounds[0].derived.collision.category = 3` |
| `S.v` | `int` | `grounds[].vanish` (alias variant) | `v="4"` -> `grounds[0].vanish = 4`; `v="4"` -> `grounds[0].variant = 4` |
| `S.m` | `bool` | `grounds[].invisible` (alias mobile) | `m=""` -> `grounds[0].invisible = true`; `m=""` -> `grounds[0].mobile = true` |
| `S.inputSpeedBonus` | `number` | `grounds[].inputSpeedBonus` | `inputSpeedBonus="2.5x"` -> `grounds[0].inputSpeedBonus = 2.5` |
| `S.outputSpeedBonus` | `number` | `grounds[].outputSpeedBonus` | `outputSpeedBonus="bad"` -> `grounds[0].outputSpeedBonus = 0` |
| `S.invertOutputPoint` | `bool` | `grounds[].invertOutputPoint` | `invertOutputPoint=""` -> `grounds[0].invertOutputPoint = true` |
| `S.addInputGroundSpeed` | `bool` | `grounds[].addInputGroundSpeed` | `addInputGroundSpeed=""` -> `grounds[0].addInputGroundSpeed = true` |
| `S.tint` | `color` | `grounds[].tint`, `grounds[].derived.tint` | `tint="ff00aa"` -> `grounds[0].tint = 16711850` |
| `S.grav` | `number` | `grounds[].gravity`, `grounds[].derived.gravityScale` | `grav="0.5"` -> `grounds[0].derived.gravityScale = 0.5` |
| `S.col` | `bool` | `grounds[].touchCollision` (alias collision) | `col=""` -> `grounds[0].touchCollision = true`; `col=""` -> `grounds[0].collision = true` |
| `S.lua` | `number` | `grounds[].lua` (number), `grounds[].luaRaw` | `lua="12.9"` -> `grounds[0].lua = 12.9` |
| `S.contact` | `int` | `grounds[].contact` | `contact="12.9"` -> `grounds[0].contact = 12` |
| `S.friction` | `list<number>` | `grounds[].friction` (raw pair), `grounds[].honey` | `friction="1.5,2.5"` -> `grounds[0].friction.y = 2.5`; `friction="20,4"` -> `grounds[0].honey = {"type":"sticky","value":100,"duration":5}`; `friction="-3,1"` -> `grounds[0].honey = {"type":"slippery","value":3,"duration":-3}`; `friction="x"` -> `grounds[0].honey.type = "glitched"` |
| `S.i` | `custom` | `grounds[].image` (raw), `grounds[].imageParts` | `i="3.9,-4,tex.png"` -> `grounds[0].imageParts = {"x":3,"y":-4,"url":"tex.png","fields":["3.9","-4","tex.png"]}`; `i="tex.png"` -> `grounds[0].imageParts = null`; `i="1,2"` -> `grounds[0].imageParts = null`; `i="1,2,a.png,extra"` -> `grounds[0].imageParts.url = "a.png"` |
| `S.P` | `list<number>` | `grounds[].physics`, `grounds[].derived.physics` | `P="1,7.5,0.9,0.1,30,1,0.4,0.6"` -> `grounds[0].physics.friction = 0.9`; `P="1"` -> `grounds[0].derived.physics.normalized.friction = 0.2`; `T="2"` -> `grounds[0].derived.physics.defaults.restitution = 1.2`; `T="1" P="0,0,-1,-2"` -> `grounds[0].derived.physics.normalized.restitution = 0` |
| `S.o` | `color` | `grounds[].color` | `o="112233"` -> `grounds[0].color = 1122867` |
| `S.N` | `bool` | `grounds[].foreground`, `grounds[].derived.foreground` | `N=""` -> `grounds[0].foreground = true` |
| `S.archAcc` | `number` | `grounds[].derived.areaPhysics.archAcc` | `T="9" archAcc="2.5"` -> `grounds[0].derived.areaPhysics.archAcc = 2.5`; `T="15" archAcc="0"` -> `grounds[0].derived.areaPhysics.archAcc = 0`; `T="0" archAcc="2.5"` -> `grounds[0].derived.areaPhysics = null` |
| `S.archMax` | `number` | `grounds[].derived.areaPhysics.archMax` | `T="9" archMax="2.5"` -> `grounds[0].derived.areaPhysics.archMax = 2.5`; `T="15" archMax="0"` -> `grounds[0].derived.areaPhysics.archMax = 0`; `T="0" archMax="2.5"` -> `grounds[0].derived.areaPhysics = null` |
| `S.archCheeseMax` | `number` | `grounds[].derived.areaPhysics.archCheeseMax` | `T="9" archCheeseMax="2.5"` -> `grounds[0].derived.areaPhysics.archCheeseMax = 2.5`; `T="15" archCheeseMax="0"` -> `grounds[0].derived.areaPhysics.archCheeseMax = 0`; `T="0" archCheeseMax="2.5"` -> `grounds[0].derived.areaPhysics = null` |
| `S.linDampAcc` | `number` | `grounds[].derived.areaPhysics.linDampAcc` | `T="9" linDampAcc="2.5"` -> `grounds[0].derived.areaPhysics.linDampAcc = 2.5`; `T="15" linDampAcc="0"` -> `grounds[0].derived.areaPhysics.linDampAcc = 0`; `T="0" linDampAcc="2.5"` -> `grounds[0].derived.areaPhysics = null` |
| `S.linDampMax` | `number` | `grounds[].derived.areaPhysics.linDampMax` | `T="9" linDampMax="2.5"` -> `grounds[0].derived.areaPhysics.linDampMax = 2.5`; `T="15" linDampMax="0"` -> `grounds[0].derived.areaPhysics.linDampMax = 0`; `T="0" linDampMax="2.5"` -> `grounds[0].derived.areaPhysics = null` |
| `S.angDampAcc` | `number` | `grounds[].derived.areaPhysics.angDampAcc` | `T="9" angDampAcc="2.5"` -> `grounds[0].derived.areaPhysics.angDampAcc = 2.5`; `T="15" angDampAcc="0"` -> `grounds[0].derived.areaPhysics.angDampAcc = 0`; `T="0" angDampAcc="2.5"` -> `grounds[0].derived.areaPhysics = null` |
| `S.angDampMax` | `number` | `grounds[].derived.areaPhysics.angDampMax` | `T="9" angDampMax="2.5"` -> `grounds[0].derived.areaPhysics.angDampMax = 2.5`; `T="15" angDampMax="0"` -> `grounds[0].derived.areaPhysics.angDampMax = 0`; `T="0" angDampMax="2.5"` -> `grounds[0].derived.areaPhysics = null` |
<!-- END:fields-ground -->

## Ground types

`T` selects the type. Friction and restitution are the values a ground starts with; a written `P` replaces them. The
minimalist colour is what the game draws instead of the texture in minimalist mode ([`limits-and-modes.md`](limits-and-modes.md)).

<!-- BEGIN:ground-types -->
| `T` | Name | Friction | Restitution | Minimalist colour | Notes |
|---|---|---|---|---|---|
| 0 | wood | 0.05 | 0.1 | `#324650` | cached as a bitmap when static |
| 1 | ice | 0 | 0.2 | `#89A7F5` |  |
| 2 | trampoline | 0 | 1.2 | `#6D4E94` |  |
| 3 | lava | 0.3 | 20 | `#D84801` | cached as a bitmap when static |
| 4 | chocolate | 20 | 0.2 | `#2E190C` |  |
| 5 | earth | 0.3 | 0.2 | `#324650` | cached as a bitmap when static |
| 6 | grass | 0.3 | 0.2 | `#324650` | cached as a bitmap when static |
| 7 | sand | 0.1 | 0.2 | `#324650` | cached as a bitmap when static |
| 8 | cloud | 0.3 | 0.2 | `#CDE1E2`, alpha 0.5 | Collision group 0 collides with shaman objects only. |
| 9 | water | 0.3 | 0.2 | `#6DA7AF`, alpha 0.3 | always in front; An area: collision group always 5, `P` is ignored, area physics attributes apply. |
| 10 | stone | 0.3 | 0 | `#324650` | cached as a bitmap when static |
| 11 | snow | 0.3 | 0.2 | `#E7F0F2` | cached as a bitmap when static |
| 12 | rectangle | 0.3 | 0.2 | `#GROUND` | Plain colour `o` (white without it). |
| 13 | circle | 0.3 | 0.2 | `#GROUND` | Plain colour `o` (white without it); `L` is the radius, `H` is ignored. |
| 14 | invisible | 0.3 | 0.2 | `#000000`, alpha 0 | Not drawn. |
| 15 | cobweb | 0.3 | 0.2 | `#919A9C`, alpha 0.3 | always in front; An area: collision group always 5, area physics attributes apply. |
| 16 | wood2 | 0.3 | 0.2 | textured | Drawn with the plain plank picture. |
| 17 | grass2 | 0.3 | 0.2 | `#324650` |  |
| 18 | grass3 | 0.3 | 0.2 | `#324650` |  |
| 19 | acid | 0.3 | 0.2 | `#51A317` | The body is marked as acid. |
| 20 | honey | 0.3 | 0.2 | `#FAD607` | Honey `20,4` unless `friction` says otherwise. |
| 21 | galaxy | 0.3 | 0.2 | `#230054`, alpha 0.3 | always in front; A cup-shaped frame rather than a solid block; the top strip is drawn behind the mice. |
<!-- END:ground-types -->

Types outside 0 to 21 (some real maps use -1, 30, 99, ...) are drawn with the plain plank picture, like wood, and get the
default physics (friction 0.3, restitution 0.2). Type 22 is not defined either.

Positions: a ground is centred on (`X`, `Y`); a circle (13) has radius `L`. Width and height are kept between 10 and 4000.

## Physics `P`

`P="dynamic,mass,friction,restitution,angle,fixedRotation,linearDamping,angularDamping"`. Water (9) ignores it.

| Field | Meaning | Static ground | Dynamic ground |
|---|---|---|---|
| 1 | `1`: dynamic (moves with physics) | | |
| 2 | mass; 0 lets the physics compute it | ignored | explicit mass when not 0 |
| 3 | friction | used | used |
| 4 | restitution (bounce) | used | used |
| 5 | angle in degrees, clockwise | used | used |
| 6 | `1`: fixed rotation | ignored | used |
| 7 | linear damping | ignored | used |
| 8 | angular damping | ignored | used |

`grav` also acts on dynamic grounds only. The shapes of a dynamic ground get density 30. A negative mass makes a dynamic ground
immovable but it keeps its other dynamic properties (it is not made static).

Missing numbers are `NaN`. Before the physics uses them, the game replaces a `NaN` friction with 0.2 and a `NaN` mass, angle or
damping with 0, and raises a negative friction or restitution to 0. The parser shows the written values in `physics`, the
type's starting values in `derived.physics.defaults`, and the values after that replacement in
`derived.physics.normalized`.

Field 3 and 4 being friction and restitution is inferred from three sources that agree: the type defaults above (ice has
friction 0, a trampoline restitution 1.2, lava restitution 20, chocolate friction 20), the usual editor defaults (0.3 and 0.2)
and the community documentation. The physics code that reads the two fields has not been seen. The editor Miceditor lists
other starting values for wood, snow and lava; the table above is the game's.

## Collision

`c` picks a collision preset. Two shapes collide when each one's mask contains the other's category bit:

<!-- BEGIN:collision-presets -->
| Preset | Category bit | Mask | Collides with | Used for |
|---|---|---|---|---|
| 0 | 32 | 0 | none | ground `c` 4 and above, water, cobweb |
| 1 | 1 | 22 | 2, 4, 16 | not a ground (mice, inferred) |
| 2 | 2 | 23 | 1, 2, 4, 16 | not a ground (mice, inferred) |
| 3 | 4 | 15 | 1, 2, 4, 8 | ground `c` 0 or 1 |
| 4 | 8 | 12 | 4, 8 | ground `c` 2; a cloud (8) with `c` 0 |
| 5 | 16 | 3 | 1, 2 | ground `c` 3; the walls around the map |
<!-- END:collision-presets -->

| `c` | Preset | Collides with |
|---|---|---|
| 0, 1 | 3 | mice and shaman objects (a cloud, 8, with `c` 0: preset 4) |
| 2 | 4 | shaman objects only |
| 3 | 5 | mice only |
| anything else | 0 | nothing |

Water (9) and cobweb (15) always use group 5 (preset 0). The masks are verified; that categories 1 and 2 are the mice and 8 the
shaman objects is inferred (it makes the presets mean what the editors describe). The community documentation numbers the
groups differently (1 all, 2 objects and grounds, 3 mice and objects, 4 nothing).

## Honey

`friction="a,b"` makes the ground honey when `a` is not 0 (it is not the friction coefficient, which is field 3 of `P`). Type 20
(honey) without the attribute uses `20,4`. A third-party editor reads the pair as sticky when `a` is 0 or more (strength `5a`)
and slippery otherwise (strength `-a`), lasting `a / b`; the parser's `honey` field follows that reading. How the game uses the
pair has not been seen.

## Area physics: water and cobweb

Water (9) and cobweb (15) are areas rather than solid grounds. They are always in front of the mice, always use collision
group 5, and read seven more attributes. Their starting values:

<!-- BEGIN:area-defaults -->
| `T` | `archAcc` | `archMax` | `archCheeseMax` | `linDampAcc` | `linDampMax` | `angDampAcc` | `angDampMax` |
|---|---|---|---|---|---|---|---|
| 9 | 0.1 | 0.5 | 0.25 | 0 | 0 | 0 | 0 |
| 15 | 0.1 | 0.3 | 0.3 | 0.5 | 28 | 0.2 | 20 |
<!-- END:area-defaults -->

What the seven values do, and in which unit, is unknown.

## Galaxy

A galaxy ground (21) is a cup-shaped frame: a 5 px bar along the bottom, two side walls of height between 7 and 15 (half of
`H`, kept in that range) and a bar of width `L - 8`. It is always in front of the mice, but the top strip of its picture is
drawn behind them. `name`, `target`, the speed bonuses, `invertOutputPoint` and `addInputGroundSpeed` belong to galaxy
grounds; what the game does with them has not been seen.

## Other attributes the game does not read

Real maps carry ground attributes no game code reads, such as `W` and `conj` from map editors. The parser keeps them in
`unknownAttributes`.
