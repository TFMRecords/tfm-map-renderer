# Settings `P`

The first child of the root, conventionally `<P>`. Every attribute is optional; when the element or an attribute is absent the
game uses the default shown. The index is [`README.md`](README.md); conversions are in [`values.md`](values.md).

## Attributes

<!-- BEGIN:attrs-settings -->
| Attribute | Read as | Meaning | Status |
|---|---|---|---|
| <a id="attr-P-nosync"></a>`nosync` | `presence`. A ground or object is synchronised only when neither it nor the settings carry `nosync`. Absent: false. | Turns off room synchronisation for every ground and object of the map. | verified |
| <a id="attr-P-theme"></a>`theme` | `truthy`, lower-cased. Only `halloween` has an effect (it changes the cheese picture, see decorations). Absent: none. | Event theme. | verified |
| <a id="attr-P-mc"></a>`mc` | `presence`. Absent: false. | Hides the pictures of the nails placed in the map: no nail picture is added during the first 5 seconds of a round. The nails still hold. | verified |
| <a id="attr-P-dodue"></a>`dodue` | `presence`. Absent: false. | Lets mice collect several cheeses; the cheese is drawn as a cheese pile. | verified |
| <a id="attr-P-aie"></a>`aie` | `presence`. Absent: false. | Makes mice shock-sensitive: falls from a height, strong bounces and being squeezed kill them. | **unverified**: What the game does with the flag has not been checked; the meaning is the community documentation's. |
| <a id="attr-P-bh"></a>`bh` | `presence`. Absent: false. | Lets cannonballs fly upwards (placed in the map or summoned by the shaman). Without it a cannonball's upward speed is set to 0. | verified |
| <a id="attr-P-mgoc"></a>`mgoc` | `int`, whenever the attribute is present (an empty value gives 0). Absent: none (objects keep their own mass). | Mass given to every shaman object except type 32, summoned or placed in the map. | verified |
| <a id="attr-P-Ca"></a>`Ca` | `presence`. Absent: false. | Hides everything outside the 800x600 game area behind a frame in the room colour. | verified |
| <a id="attr-P-G"></a>`G` | `presence`. Split on `,`: wind = `number` of field 1, gravity = `number` of field 2. A wind that is `NaN` becomes 0, a gravity that is `NaN` becomes 10. The wind is negated in a mirrored room. Absent: 0,10. | Wind (positive blows to the right) and gravity (default 10; negative turns it upside down). | verified |
| <a id="attr-P-N"></a>`N` | `presence` turns night mode on. A non-empty value is split on `,`: one field sets the size, two fields the size and the type (both `number`); any other number of fields sets neither. Absent: off. | Night mode: mice only see a small circle around them. First number: the size of the circle; second: who is in the dark (0 everyone, 1 the shaman, 2 the mice). Default `150,0`. | **unverified**: Whether the first number is a radius or a diameter, and what the second number selects, have not been checked in the game. |
| <a id="attr-P-C"></a>`C` | `presence`. Absent: false. | Collision mode: mice collide with each other. | **unverified**: The effect has not been checked in the game; the meaning is the community documentation's. |
| <a id="attr-P-A"></a>`A` | `presence`. Absent: false. | Soulmate mode: mice are tied in pairs. The game draws a heart near the top left corner. | verified |
| <a id="attr-P-F"></a>`F` | `int`, whenever the attribute is present. Absent: none (no background). | Map background: the picture `$F_<id>`, drawn behind everything and stretched to the map size. `-1`: none; `-2`: the game picks one at random. | verified |
| <a id="attr-P-P"></a>`P` | `presence`. Absent: false. | Lets the shaman summon portals. | **unverified**: The effect has not been checked in the game; the meaning is the community documentation's. |
| <a id="attr-P-shaman_tools"></a>`shaman_tools` | `truthy`. Split on `,`, each field `int`; zeros are dropped, and an empty result counts as no list. Absent: none (the usual objects). | Replaces the objects the shaman can summon with these ids. The arrow (0) cannot be added, skills do not work, and a skinned object only shows for players who own the skin. | verified |
| <a id="attr-P-defilante"></a>`defilante` | `presence` turns defilante mode on. Split on `,`: start speed = `int` of field 1 (at least 0) / 36, acceleration = `number0` of field 2 / 360, maximum speed = `number0` of field 3 / 36, free scroll = field 4 is `one`. Absent: off. | Defilante (scrolling race) mode. In this mode the objects 6, 32, 15 and 16 become markers instead of objects, and the width limit of a restricted map is 4800. | verified |
| <a id="attr-P-L"></a>`L` | `truthy`, then `int`. An empty value keeps the default. Absent: 800. | Map width in pixels. The documented maximum is 1600 (4800 with `defilante`); the game enforces it only for restricted maps, and saved maps are often wider. | verified |
| <a id="attr-P-H"></a>`H` | `truthy`, then `int`. An empty value keeps the default. Absent: 400. | Map height in pixels. The documented maximum is 800; the game enforces it only for restricted maps. | verified |
| <a id="attr-P-DS"></a>`DS` | `truthy`. The value is `kind;payload` with exactly one `;`, otherwise it is ignored. `m;x1,y1,x2,y2,...`: up to 20 points (at most 40 numbers are read, an odd last number is dropped); `x;N`: X fixed at N, random Y; `y;N`: Y fixed at N, random X; `r;x,y,w,h`: a rectangle. All numbers `int`; other kinds are ignored. Absent: none (the `DS` decoration, if any). | Mouse spawn points. | verified |
| <a id="attr-P-D"></a>`D` | `truthy`. `#url,w,h`: one tiled bitmap; a value without a comma: one image at (0, 0); otherwise `;`-separated groups of `url,x,y,repeat,dx` tuples. Absent: none. | Background images, drawn behind the grounds. | verified |
| <a id="attr-P-d"></a>`d` | `truthy`. A value without a comma: one image at (0, 0); otherwise `;`-separated groups, each a run of 4-field tuples `url,x,y,repeat`. The repeat offset is the fifth field of the last `D` tuple (a bug of the game). Absent: none. | Foreground images, drawn over the grounds, the objects and the mice. | verified |
| <a id="attr-P-APS"></a>`APS` | `truthy`. `;`-separated groups; only a group of exactly 8 fields `url,mode,x,y,w,h,imageX,imageY` makes an image. Absent: none. | Disappearing images: drawn whole at (imageX, imageY) in the top layer, they fade out while the player is inside the rectangle (x, y, w, h). Off in restricted maps. | verified |
| <a id="attr-P-ARPS"></a>`ARPS` | `truthy`. Same 8-field groups as `APS`. Absent: none. | Appearing images: not shown at load; an image fades in, in the bottom layer, while the player is inside its rectangle, and fades out when they leave. Only in maps opened as official maps. | verified |
| <a id="attr-P-IP"></a>`IP` | `truthy`. `;`-separated groups; only a group of exactly 3 fields `url,x,y` makes an image. Absent: none. | Images a server message shows for 5 seconds on a few event maps; not shown at load. Off in restricted maps. | verified |
<!-- END:attrs-settings -->

## Parser fields

<!-- BEGIN:fields-settings -->
| Spec id | Type | Parser field | Examples (checked by the tests) |
|---|---|---|---|
| `P.nosync` | `bool` | `settings.nosync` | `nosync=""` -> `settings.nosync = true` |
| `P.theme` | `string` | `settings.theme`, `settings.themeHalloween` | `theme="HalloWeen"` -> `settings.themeHalloween = true` |
| `P.mc` | `bool` | `settings.hideNails` | `mc=""` -> `settings.hideNails = true` |
| `P.dodue` | `bool` | `settings.dodue` | `dodue=""` -> `settings.dodue = true` |
| `P.aie` | `bool` | `settings.aie` | `aie=""` -> `settings.aie = true` |
| `P.bh` | `bool` | `settings.upwardsCannonballs` | `bh=""` -> `settings.upwardsCannonballs = true` |
| `P.mgoc` | `int` | `settings.shamanObjectsMass` | `mgoc="7.9"` -> `settings.shamanObjectsMass = 7` |
| `P.Ca` | `bool` | `settings.hideOffscreen` | `Ca=""` -> `settings.hideOffscreen = true` |
| `P.G` | `list<number>` | `settings.wind`, `settings.gravity`, `settings.derived` | `G="1.5,12"` -> `settings.gravity = 12`; `G="x,3"` -> `settings.derived.wind = 0`; `G="1"` -> `settings.derived.gravity = 10` |
| `P.N` | `list<number>` | `settings.night` | `N="250,1.5"` -> `settings.night.type = 1.5`; `N="250"` -> `settings.night.diameter = 250` |
| `P.C` | `bool` | `settings.collisions` | `C=""` -> `settings.collisions = true` |
| `P.A` | `bool` | `settings.soulmate` | `A=""` -> `settings.soulmate = true` |
| `P.F` | `int` | `settings.backgroundImageId` | `F="3.9"` -> `settings.backgroundImageId = 3` |
| `P.P` | `bool` | `settings.portals` | `P=""` -> `settings.portals = true` |
| `P.shaman_tools` | `list<int>` | `settings.shamanTools` | `shaman_tools="0,6,bad,2"` -> `settings.shamanTools = [6,2]` |
| `P.defilante` | `list<number>` | `settings.defilante` | `defilante="10,1,2,1"` -> `settings.defilante.freeScroll = true` |
| `P.L` | `int` | `settings.width` | `L="900.7"` -> `settings.width = 900` |
| `P.H` | `int` | `settings.height` | `H="500"` -> `settings.height = 500` |
| `P.DS` | `custom` | `settings.miceSpawn` | `DS="r;1,2,3,4"` -> `settings.miceSpawn.height = 4` |
| `P.D` | `custom` | `settings.images.background` | `D="a.png,5,6,2,30"` -> `settings.images.background[0].repeatArg = "30"` |
| `P.d` | `custom` | `settings.images.foreground` | `D="b.png,0,0,0,7" d="a.png,1,2,3"` -> `settings.images.foreground[0].repeatArg = "7"` |
| `P.APS` | `custom` | `settings.images.disappearing` | `APS="a.png,0,1,2,3,4,5,6"` -> `settings.images.disappearing[0].rect.right = 4` |
| `P.ARPS` | `custom` | `settings.images.appearing` | `ARPS="a.png,1,10,20,30,40,5,6"` -> `settings.images.appearing[0].imagePosition.y = 6` |
| `P.IP` | `custom` | `settings.images.ip` | `IP="o.png,12,34"` -> `settings.images.ip[0].y = 34` |
<!-- END:fields-settings -->

## Map size

`L` and `H` give the map size in pixels; the default is 800 x 400. The documented maximum is 1600 x 800 (4800 wide with
`defilante`), but the game only enforces it for restricted maps ([`limits-and-modes.md`](limits-and-modes.md)), and saved maps
are often larger: some real maps are tens of thousands of pixels wide. The in-game editor draws a map smaller than 800 x 400 at
that size.

## Background `F`

`F="n"` draws the picture `$F_n` behind everything. The game draws the picture into an 800 x 400 area and stretches that area
to the whole map, so a picture wider than 800 shows only its left 800 pixels (`$F_4` is 1600 wide and `$F_6` 4800 wide). Ids 0
to 11 exist; the game asks its libraries for any id and draws nothing when none defines it. `-1` means no background;
`-2` makes the game pick one of 0, 1, 2, 3, 0, 7 at random. Minimalist mode draws no background. Verified in the game for
0 to 11 and on maps of 1200 x 600 and larger.

The in-game editor draws the picture unstretched at 800 x 400 in the top left corner, and `-2` as 0.

## Gravity and wind `G`

`G="wind,gravity"`. Wind blows to the right when positive and moves shaman objects; gravity 10 is normal and a negative value
turns it upside down. A missing or unreadable number gives wind 0 or gravity 10, an empty field gives 0
(`G="0,"` means no gravity at all). The game adds a tiny random amount to the gravity. Verified in the game.

## Mouse spawn `DS`

`DS="kind;payload"`, with exactly one `;` (anything else is ignored):

| Kind | Payload | Effect |
|---|---|---|
| `m` | `x1,y1,x2,y2,...` | spawn points; at most 40 numbers are read (20 points) and an odd last number is dropped |
| `x` | `N` | X fixed at `N`, random Y over the map height |
| `y` | `N` | Y fixed at `N`, random X over the map width |
| `r` | `x,y,w,h` | a spawn rectangle |
| other | | ignored |

The `DS` decoration ([`decorations.md`](decorations.md)) places a single spawn point.

## Defilante

`defilante` turns on defilante mode (a race on a scrolling map). Its value is `start,acceleration,max,freeScroll`; see the
table for the arithmetic. In defilante mode:

- the shaman objects 6, 32, 15 and 16 are not created as objects but become markers of kind 0, 1, 2 and 3 (the raw `C` is
  compared, so skins of these types are not markers);
- the width limit of a restricted map is 4800 instead of 1600;
- minimalist mode is off.

## Images

`D`, `d`, `APS`, `ARPS` and `IP` place images; their syntax and URLs are in [`images.md`](images.md).

## Flags that change the picture

| Attribute | Effect on the picture |
|---|---|
| `A` (soulmate) | a heart (`$P5`) at (12, 30) in the top layer |
| `Ca` | everything outside the 800 x 600 game area is covered by a frame in the room colour, over everything, not mirrored |
| `dodue` | the cheese is drawn as a cheese pile (`$FromageDodue`) |
| `theme="halloween"` | the cheese picture gets the theme suffix ([`decorations.md`](decorations.md)) |
| `mc` | the map's nails are not drawn ([`objects.md`](objects.md)) |

## Attributes the game does not read

Real maps carry many settings attributes the game ignores: data of map editors (`MEDATA`), of Lua modules (`author`, `title`,
`Laps`, ...) and the old `PNJ`, which placed characters from the map in 2012 and has had no effect since (the parser reports
`deprecated-attribute`). The parser keeps all of them in `unknownAttributes`.
