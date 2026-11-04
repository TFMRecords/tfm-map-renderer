# Parser API

How to call the parser and what it returns. The function reference below is generated from the JSDoc of the exports of
`src/index.js` (`npm run docs:xml`; `npm test` fails when it is stale). Which XML attribute ends up in which field, with tested
examples, is in the "Parser fields" tables of [`../xml/`](../xml/README.md); the diagnostics are listed in
[`../xml/values.md`](../xml/values.md#diagnostics).

```js
import { parseTfmMap, parseTfmDocument, serializeXml } from "tfm-map-renderer";

const map = parseTfmMap(xml);                          // semantic map
const { map: same, document } = parseTfmDocument(xml); // plus the source AST, for exact edits and round trips
```

**What the XML says, not what the game does with it.** The parser returns source values. It does not clamp sizes, cut the
lists of grounds, decorations or objects, mirror coordinates, apply map modes, or drop images that a restricted map would not
show: a width of `99999` stays `99999`, a repeat count of `999` stays `999`, ground `i`, `APS`, `ARPS` and `IP` are parsed when
present. Those decisions belong to the renderer ([`renderer.md`](renderer.md), `clientLimits`, `mirrorX`) or to a caller. Where
the game replaces a value right away, the result is offered next to the raw one under `derived` (below).

**It does not throw on map problems.** Markup it cannot read at all throws `XmlSyntaxError`; everything else (a map the game
would refuse, an attribute the editor could not have saved, recovered malformed markup) is a diagnostic in
`map.source.diagnostics`, and `map.source.clientLoads` is `false` when the game would fail to load the map.

## Structure modes (`structureMode`)

| Mode | Behaviour |
|---|---|
| `client` (default) | Containers are found by position among the **element** children, as the game does, but text between tags is ignored. Content is therefore extracted even from a map the game would reject; `source.clientLoads` and the `text-node-breaks-positional-slots` diagnostic say so. |
| `client-raw` | By position among element **and** text children: exactly what the game does with text between tags (a text node in a container's position counts as a missing container). |
| `named` | Finds `P`, `Z`, `S`, `D`, `O` and `L` by name. A tool convenience; the game never does this. |
| `hybrid` | Names first, positions as fallback. Tool convenience. |

See [`../xml/values.md`](../xml/values.md#text-between-tags) for what the game does with text between tags.

## Derived values

`derived` fields hold values the game computes directly from the attributes; the raw value stays next to them.

`grounds[].derived`:

| Field | Value |
|---|---|
| `width`, `height` | `L` and `H` kept in [10, 4000]. For a circle (`T=13`) `L` is the radius. |
| `foreground` | `N` present, or `T` is 9, 15 or 21 |
| `collisionGroup` | 5 for water (9) and cobweb (15), otherwise `int(c)` |
| `collision` | `{mice, objects, category}`: who collides with the ground ([`grounds.md`](../xml/grounds.md#collision)) |
| `collisionFilter` | `{preset, categoryBits, maskBits, collidesWithBits}`: the exact collision preset of the ground's shapes |
| `gravityScale` | `grav` when present, otherwise 1 |
| `tint` | `tint` when present, otherwise `0x808080` |
| `packedPhysicsApplies` | `false` for water (9), which ignores `P` |
| `physics.defaults` | the type's starting physics, before `P` ([`grounds.md`](../xml/grounds.md#ground-types)) |
| `physics.effective` | `P` instead of the defaults; `NaN` where a field is missing |
| `physics.normalized` | `effective` after the game replaces `NaN` and negative values; what the physics uses ([`grounds.md`](../xml/grounds.md#physics-p)) |
| `dynamicBody` | `null` for a static ground; otherwise `{massMode, mass, inertia, density, linearDamping, angularDamping, fixedRotation, gravityScale}` (`massMode` is `explicit` when the mass is not 0, else `computed-from-shapes`; density 30) |
| `areaPhysics`, `area` | water and cobweb only: the seven area attributes, and `{kind, rect, physics}` with the type's defaults filled in ([`grounds.md`](../xml/grounds.md#area-physics-water-and-cobweb)) |

Other fields that are not a single attribute:

| Location | Field | Meaning |
|---|---|---|
| `map.source` | `clientLoads` | `false` when the game would fail to load the map (it then loads map 0) |
| `map.source` | `editor` | `{ok, count, characters[]}`: characters the editor would refuse to save |
| `map.source.diagnostics[]` | `severity` | `client-error`, `client-quirk`, `editor-limit` or `info` |
| `settings` | `derived` | `{wind, gravity}` with `NaN` replaced by 0 and 10 |
| `settings` | `themeHalloween` | `theme` lower-cases to `halloween` (the only theme the game keeps) |
| `settings.miceSpawn` | `ignoredFields` | numbers of `DS="m;..."` beyond 40 or an odd count |
| `objects[]` | `baseType`, `skin` | `C` split into type and skin ([`objects.md`](../xml/objects.md#type-and-skin-c)) |
| `objects[]` | `clientFiltered` | the game does not create objects of this base type |
| `objects[]` | `defilanteMarker` | 0 to 3 when the map has `defilante` and `C` is 6, 32, 15 or 16; such nodes are markers, not objects |
| `joints[]` (unknown tag) | `staleCarry` | `{targetIndex, style, clientLuaId}`: the game applies `c` and `lua` to the previous joint |
| `particles[]` | `clientCreated`, `derived.duration` | an empty `id` creates nothing; the lifetime of each particle is capped at 10000 |
| `particles[]` | `derived.position`, `derived.speed`, `derived.acceleration` | what the emitter emits with, absent values as 0: position `{x, y}`, speed and acceleration `{x: {from, to}, y: {from, to}}` ([`particles.md`](../xml/particles.md#how-the-game-emits-particles)) |
| `particles[].speed`, `.acceleration` | `secondGroupMissing` | the value would make the map fail to load |
| `grounds[]` | `imageParts` | `{x, y, url, fields}` from `i="x,y,url"`, `null` with fewer than 3 fields |

Absent attributes come back as `null` or `false`, not as the game's defaults; only `derived` fills defaults in.

## Modules

`map.modules` holds what Lua modules make of the map, one entry per supported module, for every map: for now
`map.modules.parkour` (checkpoints with their size, cheese and stop, the end chair, and whether the map is a parkour map at all).
The module attributes themselves (`stop`, `size`, `cheese`) stay in `attributes` like any other. See
[`../xml/modules.md`](../xml/modules.md).

## Names and aliases

Where the third-party editor Miceditor has a name for a field, the parser uses it and keeps the earlier name as an alias:

| Field | Alias | Attribute |
|---|---|---|
| `grounds[].collisionGroup` | `colorCode` | `c` |
| `grounds[].vanish` | `variant` | `v` |
| `grounds[].invisible` | `mobile` | `m` |
| `grounds[].touchCollision` | `collision` | `col` |
| `decorations[].holeColor` | `holeType` | `CT` |
| `joints[].damping` | `amplitude` | `AMP` |
| `joints[].frequency` | `hz` | `HZ` |
| `particles[].position` | `orientation` | `ori` (the emitter's position, not a direction) |

The `friction="a,b"` attribute is honey, kept as the raw pair in `grounds[].friction` and decoded in `grounds[].honey`; the
friction coefficient is `grounds[].physics.friction` (field 3 of `P`).

## Extensions

`extensions: [{ name, scopes, match(node), decode(node, context) }]` observes nodes without changing the core result. Scopes are
`settings`, `root-child`, `zone-child`, `ground`, `decoration`, `object`, `joint` and `particle`; results are collected in
`map.extensions.decoded`. Unknown attributes are kept in `unknownAttributes` and unknown nodes in `map.extensions.unknown`
unless `preserveUnknown: false`.

## Source-aware editing

`parseTfmDocument` returns `{ map, document }`. `serializeXml(document, { mode: "preserve" })` reproduces the source byte for
byte; `{ mode: "canonical" }` writes the AST back out. Edits made with `setXmlAttributeValue`, `appendXmlAttribute` and
`removeXmlAttribute` change only the edited bytes. An edit targets one exact attribute entry (`attributeEntries(node, name)`
lists every occurrence in source order), so a repeated attribute is never resolved silently; the game itself uses the last one.
`getXmlNodeById(document, semantic.source.nodeId)` leads from any parsed record back to its node.

## Image URLs

`resolveClientImageUrl(source, url, options)` returns the URL the game would request for a map image. `source` is `"D"`, `"d"`,
`"IP"`, `"APS"`, `"ARPS"`, `"ground-i"` (pass the `url` of `imageParts`), `"particle"` or `"D-tiled"` (the `value` of a
`specialType: "tiled-bitmap"` background record). Absolute URLs are refused unless `unofficialDomains: true`; even then only
ground `i` (outside `#Module` maps, `moduleMode`) and tiled `D` can load them, as in the game. The rules are in
[`../xml/images.md`](../xml/images.md#image-urls). Neither the parser nor the renderer does network I/O.

## Function reference

<!-- BEGIN:api -->
### `src/xml/parse.js`

#### `parseXml`

`function parseXml(source, userOptions = {})`

Pure-JS, non-DOM XML parser intended for Transformice source preservation.
It accepts ordinary XML plus duplicate attributes (preserved + diagnosed).
Client-specific malformed-markup recovery is intentionally not guessed: by default (`lenient: false` makes it strict) the three cases seen in real maps
(docs/xml/values.md#malformed-xml-the-game-accepts) are recovered, each with a `lenient-recovery` diagnostic.

#### `serializeXml`

`function serializeXml(document, { mode = "preserve" } = {})`

Serialize a parsed document. `mode: "preserve"` (default) returns the original bytes, with exact attribute edits applied surgically so unrelated spacing, quoting and order survive; `mode: "canonical"` writes a normalised form.


```js
const { map, document } = parseTfmDocument(xml);
serializeXml(document, { mode: "preserve" });

```

#### `XmlSyntaxError`

`class XmlSyntaxError extends SyntaxError`

Thrown by `parseXml` for malformed XML. Carries the source offset of the problem.

#### `elementChildren`

`function elementChildren(node)`

Element children of a node, in source order (text, comments and CDATA are skipped).

#### `attributeEntries`

`function attributeEntries(node, name)`

All attribute occurrences of `node` (every occurrence of `name` when given, in source order). Duplicates are kept: the client's lookup is last-wins, but Lua tooling may repeat attributes on purpose.

#### `getXmlNodeById`

`function getXmlNodeById(document, nodeId)`

Resolve a `source.nodeId` found in the parsed map back to its AST node of `document`, for editing.

#### `attributeMap`

`function attributeMap(node)`

Attribute name -> value of a node, last occurrence winning (the client's lookup rule).

#### `getAttribute`

`function getAttribute(node, name)`

Value of attribute `name` on `node` (last occurrence), or `undefined`.

#### `hasAttribute`

`function hasAttribute(node, name)`

Whether `node` carries attribute `name` at all (`attr=""` counts: the client tests `!= null`).

#### `setXmlAttributeValue`

`function setXmlAttributeValue(document, attribute, value)`

Change one exact attribute entry. This is duplicate-attribute safe because callers
pass the entry object returned by attributeEntries(node), not only its name; the client's lookup is
last-wins, but custom/Lua tooling may repeat attributes on purpose, so mutation is occurrence-explicit.

The original quote style (or unquoted form) is kept when possible and the new value is entity-escaped.
Setting the decoded value it already has is a byte-preserving no-op, and reverting an edit restores the original raw
entity spelling. An entry that belongs to another document is rejected.


```js
const { map, document } = parseTfmDocument(`<C><P L='800' custom="a"/><Z><S/><D/><O/></Z></C>`);
const settings = getXmlNodeById(document, map.settings.source.nodeId);
const width = attributeEntries(settings, "L")[0];
setXmlAttributeValue(document, width, "900");
const added = appendXmlAttribute(document, settings, "H", "400");
removeXmlAttribute(document, added);
serializeXml(document, { mode: "preserve" });
// <C><P L='900' custom="a"/><Z><S/><D/><O/></Z></C>

```

#### `appendXmlAttribute`

`function appendXmlAttribute(document, node, name, value, { quote = '"' } = {})`

Append an attribute without rewriting the rest of the start tag: it is inserted before the original closing-tag whitespace.

#### `removeXmlAttribute`

`function removeXmlAttribute(document, attribute)`

Remove one exact attribute entry (and only that one) without choosing among duplicates by name.

### `src/tfm/editor-limits.js`

#### `findEditorViolations`

`function findEditorViolations(xml)`

@param {string} xml
@returns {{ok:boolean,count:number,characters:Array<{char:string,codepoint:number,count:number,firstOffset:number,reason:string}>}}

#### `EDITOR_ALLOWED`

`const EDITOR_ALLOWED`

Pattern of the only characters the map editor saves: `a-z A-Z 0-9`, the space, and `< > " ' - _ . , : ; = / #`.

### `src/tfm/parse-map.js`

#### `parseTfmMap`

`function parseTfmMap(source, userOptions = {})`

Parse Transformice map XML into semantic JSON that says what the XML says. Runtime limits, mirroring, map modes and feature gating of the game client are NOT applied (a renderer or client-emulation layer decides those after parsing). Never throws on map-level problems: they are reported as `map.source.diagnostics` and `map.source.clientLoads`.

Options (all optional):
- `preserveUnknown` (default `true`): keep unknown attributes and nodes.
- `structureMode`: how the root, zone and containers are found.
  - `"client"` (default): positional **element** children, as the client does; text between tags does not shift slots.
  - `"client-raw"`: positional over legacy `childNodes`, so text nodes occupy slots, exactly as the game reads an un-compacted payload.
  - `"named"`: find `P/Z/S/D/O/L` by name (tool convenience).
  - `"hybrid"`: names first, positions as fallback.
- `extensions`: `[{ name, scopes, match(node), decode(node, context) }]` observers for custom tags. Scopes: `settings`, `root-child`, `zone-child`, `ground`, `decoration`, `object`, `joint`, `particle`. Results are stored apart from the core representation.
- `xml`: `{ allowDoctype: false, allowUnquotedAttributes: false, unknownEntity: "preserve" }`.


```js
import { parseTfmMap } from "tfm-map-renderer";
const map = parseTfmMap(xml, { structureMode: "client" });
map.grounds[0].derived.dynamicBody;

```

#### `parseTfmDocument`

`function parseTfmDocument(source, userOptions = {})`

Parse Transformice map XML into source-semantic JSON.
Runtime limits, mirroring, map modes and feature gating are intentionally not applied.

#### `legacyChildNodes`

`function legacyChildNodes(node)`

Children of a node the way legacy `flash.xml.XMLNode.childNodes` lists them: elements and text/CDATA nodes. Used by `structureMode: "client-raw"`.

#### `KNOWN_ATTRIBUTES`

`const KNOWN_ATTRIBUTES`

Per scope (`settings`, `ground`, `object`, `decoration`, `joint`, `particle`) the set of attribute names the parser decodes. Anything else is kept in `unknownAttributes`.

### `src/tfm/codecs.js`

#### `as3Number`

`function as3Number(value)`

The `number` conversion, AS3 `Number(s)`: `undefined` -> `NaN`, `""` -> 0, hex and `Infinity` accepted, JS-only `0b11` / `0o7` / `1_000` -> `NaN`.

#### `as3NumberOrZero`

`function as3NumberOrZero(value)`

The `number0` conversion (docs/xml/values.md#conversions): `Number(s)` with `NaN` replaced by 0 (infinities kept).

#### `as3Int`

`function as3Int(value)`

The `int` conversion, AS3 `int(s)`: truncates toward zero, wraps modulo 2^32, `NaN`/`undefined`/`"abc"` -> 0, hex accepted.

#### `as3ParseFloat`

`function as3ParseFloat(value)`

The `float` conversion, AS3 `parseFloat(s)`; `undefined` -> `NaN`.

#### `as3ParseInt`

`function as3ParseInt(value, radix = 10)`

AS3 `parseInt(s, radix)` (with radix 16, the `hex` conversion); `undefined` -> `NaN`; `parseInt("0x10", 10)` is 0.

#### `as3Truthy`

`function as3Truthy(value)`

The `truthy` test, AS3 truthiness of a string: `""` false, `"0"` true.

### `src/render/svg.js`

#### `renderTfmSvg`

`function renderTfmSvg(map, options = {})`

Deterministic SVG renderer baseline.

It renders source geometry and all image records for which an AssetResolver
supplies an href. Without assets it falls back to built-in placeholders (grounds as plain
filled rectangles/circles, spawns, cheese and holes as simple marks); pass
`defaultAssets: false` to draw only what a resolver supplies. `renderTiledBackgrounds: true` draws the tiled `D` backgrounds (`#url,w,h`, external images: off by default). `backgroundColor` is the colour painted behind everything (default `DEFAULT_ROOM_COLOR`, the game's #6A7495, unless `defaultAssets` is false; `null`, `"none"` or `"transparent"` leave it transparent). `spawnMarkers` chooses how `DS`/`DC`/`DC2` are drawn: `"editor"` (default: the in-game editor's `AnimStatique`/`AnimStatiqueC` clips, including its `DC2` quirk; circles when the resolver has no `AnimStatique`), `"circles"` (simple dots) or `"none"` (the game draws none). It never fetches an external URL itself. Decorations and
shaman objects can be connected to extracted sprite assets through explicit
resolver callbacks until their SWF symbol mapping is established.
With a resolver that knows the game's `$T_n` tiles (an asset release) grounds are drawn with the game's
textures (`ground-texture.js`): `textures: false` turns that off, `textureSeed` fixes the random tile choice, and
`pregeneratedBitmaps: true` selects what the game does in slow mode or on mobile (docs/rendering.md#grounds; off by
default, so static grounds get the `$E_1` overlay). A ground whose assets are missing falls back to the placeholder.
Holes and cheese use the client's `$Trou_Souris` / `$Fromage*` clips when the resolver has them (placeholders otherwise).
Decorations are drawn from the resolver's `$P_<type>` clips (default) with the client's mirroring; a resolver that has no such
clip simply draws none.
`settings.F` backgrounds (`$F_n`) are drawn when the resolver knows them; for `F="-2"` (random in the client) the picture is a composite of the client's backgrounds 0, 1, 2, 3 and 7, one vertical strip each
(`compositeRandomBackground: false` picks one with `randomBackgroundIndex` from `RANDOM_BACKGROUND_IDS` instead).
Decorations with `P` = `0,2` (flip with probability 1/2 in the client) are drawn unflipped; `randomDecorationFlip: true` flips them by a seeded coin.
`clientLimits` chooses what the game would cut or switch off (see client-limits.js, docs/xml/limits-and-modes.md#restricted-maps): a preset
(`"unrestricted"`, the default, draws everything the XML says; `"restricted"`, an ordinary player map (not official, not `#Module`): width 1600
(4800 with `defilante`), height 800, 60 grounds, 50 decoration nodes, 40 shaman objects, and ground `i`, `APS`, `ARPS`, `IP`,
tiled `D` and repeat clones off; `"module"`, a `#Module` room: no caps, ARPS off) or an object of custom
values (`{ preset: "restricted", maxGrounds: 200 }`). `restricted: true` is an alias of `clientLimits: "restricted"`. The parsed
map is never modified. (`limits` is something else: the maximum output size in pixels.)
`maxViewport: { width, height }` is a soft limit in map units: a larger viewport (or map, without one) is cut down to it from its
top-left corner instead of failing (`renderedViewport` tells whether it was). Whatever lies wholly outside the viewport is left out (cull.js).
With `renderHideOffscreenFrame: true`, `Ca` maps (`hideOffscreen`) get the client's frame in the room colour around the 800x600 play area (opt-in: `renderHideOffscreenFrame: true`; off by default); with `renderSoulmateHeart: true` (off by default) `A` maps (`soulmate`) get the `$P5` heart at (12, 30) when the resolver has it.
Blur: hole glows use Flash's exact box blurs (three passes of width 5); `flashBlur: false` uses a Gaussian instead. The bundle resolver does the same for the clips' own filters (`loadRelease(dir, { flashBlur })`).
`renderAppearingImages: true` draws the `ARPS` images and `renderIpImages: true` the `IP` images (server-triggered pictures of a few event maps; `renderPortalImages` is the old name) as if shown (both off by default: the game shows an `ARPS` image only while the player
stands in its rectangle and an `IP` image for 5 s after a server packet); `ARPS` needs `clientLimits.arps`, `IP` an unrestricted map.
Nails: with `objectMode: "game"` every nail is drawn (when a nail is made is physics and run time, not the picture); `nailVisibility: "client"` applies the client's rules instead (joins at least one or two bodies, the limit of 11 rotating joints, `mc`, one world-nail picture per body: reference 19.5).
Joints with a style (`c`) are drawn as the client draws them (`renderJoints: false` leaves them out).
`modules` turns the overlays of Lua modules on or off: `{ parkour: "auto" }` (default; drawn when the parser detected a parkour
map: its checkpoints, their size, cheese and stop), `true` to force, `false` to hide; `modules: false` hides all.
`parkourNails: false` leaves out the checkpoint nail the parkour overlay draws over each checkpoint mouse (on by default, as in Miceditor).
`parkourStyle` sets the tint of `stop` checkpoints and the height and colours of the checkpoint number and size labels (`resolveParkourStyle` in modules/parkour.js).
`minimalist: true` reproduces the client's minimalist mode (user option 14): grounds are the client's flat colours per
type (`ground-textures.js`, `flat`), the `F` background, the background `D` images (the `#` tiled bitmap stays) and the `$P_` decoration
pictures are not drawn.  The client ignores the option for map mode 22 and for
`defilante` maps; callers decide that.

#### `renderTfmScene`

`function renderTfmScene(map, options = {})`

What `renderTfmSvg` draws, as a scene (src/render/scene.js, docs/rendering.md#scene): the root `svg` node, with the same
options. `sceneToSvg` turns it into the SVG text; another backend can draw it directly.

#### `renderedViewport`

`function renderedViewport(map, options = {})`

The part of the map `renderTfmSvg` draws with these options, in map units: `viewport` (default the whole map, after
`clientLimits`) cut down to `maxViewport`; `cropped` says whether it was.
@returns {{x:number, y:number, width:number, height:number, mapWidth:number, mapHeight:number, cropped:boolean}}

#### `DEFAULT_LIMITS`

`const DEFAULT_LIMITS`

Size limits of the renderer (not of the game: the client has no size limit for a map loaded from XML, and saved
maps exist with a width of 1000000000). They guard the output size in pixels (viewport x scale), so a huge
map renders only when the caller picks a viewport/scale or raises the limit.

### `src/render/scene.js`

#### `sceneToSvg`

`function sceneToSvg(node)`

The SVG text of a scene (or of a node, or an array of nodes).

### `src/render/client-limits.js`

#### `CLIENT_LIMIT_PRESETS`

`const CLIENT_LIMIT_PRESETS`

Named presets. `unrestricted` (the default) draws what the XML says.

#### `resolveClientLimits`

`function resolveClientLimits(spec)`

@param {string|false|null|undefined|object} spec a preset name (`"restricted"`, `"module"`, `"unrestricted"`), `false`/`"none"`
  for no limits, or an object of limit values, optionally with `preset` naming the base to override
@returns {typeof NONE}

#### `applyClientLimits`

`function applyClientLimits(map, limits)`

A copy of the map as the client would read it under `limits`. The parsed map is never modified.
@param {object} map a parsed TfmMap
@param {ReturnType<typeof resolveClientLimits>} limits

### `src/assets/url-policy.js`

#### `IMAGE_BASES`

`const IMAGE_BASES`

The two official image bases the game uses: `transformice` (`http://www.transformice.com/images/`, the default) and `atelier801` (`http://images.atelier801.com/`, for a bare file name in ground `i`, `APS` and `ARPS`).

#### `isAtelier801BareImageName`

`function isAtelier801BareImageName(value)`

Whether `value` is a bare file name (`^[a-z0-9]+\.[a-z]+$`, case-insensitive), which selects the Atelier801 base.

#### `resolveTfmImageUrl`

`function resolveTfmImageUrl(source, kind = "standard")`

The URL the game builds for an image reference of `kind`:

- `"standard"` (`D`, `d`, `IP`, particle `img`, tiled `D`): always the transformice.com base.
- `"bare-name"` (ground `i`, `APS`, `ARPS`): the Atelier801 base for a bare file name, the transformice.com base otherwise.

This function only constructs an official URL. It never performs I/O.

#### `classifyImageReference`

`function classifyImageReference(source, kind = "standard")`

Describe how the game would build the URL for `source`: `{ kind, source, host, base, rule, ... }`. `kind` as in `resolveTfmImageUrl`. Performs no I/O.

### `src/assets/image-urls.js`

#### `resolveClientImageUrl`

`function resolveClientImageUrl(source, raw, options = {})`

Resolve the URL the game would request for a map image reference.

@param {"D"|"d"|"IP"|"APS"|"ARPS"|"ground-i"|"particle"|"D-tiled"} source which map attribute the string came from
  (for "ground-i" pass the URL field of `ground.imageParts`, not the whole `i` value)
@param {string} raw the URL string exactly as it appears in the map
@param {object} [options]
@param {"http"|"https"} [options.scheme="http"] client-exact is http; browsers usually need https
@param {boolean} [options.unofficialDomains=false] allow absolute http(s) URLs. The game only supports
  them for ground `i` outside #Module maps; this tool additionally requires the explicit opt-in everywhere
@param {boolean} [options.moduleMode=false] the map was loaded in "#Module" mode
@param {string|number} [options.cacheId] the game's cache-buster, appended to D, d and IP as ?c=<cacheId>
@returns {{ok:true,url:string,cacheKey:string,host:string,rule:string,provenance:string,source:string,clientUrl:string}
         |{ok:false,reason:string,source:string}}

#### `isOfficialHost`

`function isOfficialHost(host)`

Whether `host` is in `OFFICIAL_HOSTS`.

#### `OFFICIAL_HOSTS`

`const OFFICIAL_HOSTS`

Hosts accepted without the `unofficialDomains` flag.

### `src/tfm/client-constants.js`

#### `OBJECT_FILTER`

`const OBJECT_FILTER`

Base object types the game does not create as shaman objects (docs/xml/objects.md#which-objects-exist).

#### `decodeObjectType`

`function decodeObjectType(c)`

Split an encoded object type into [baseType, skin] (docs/xml/objects.md#type-and-skin-c):
  C > 9999 -> [int((C - 10000) / 10000), (C - 10000) % 10000]
  C > 99   -> [int(C / 100), C % 100]
  else     -> [C, 0]

#### `groundConstructorPhysics`

`function groundConstructorPhysics(type)`

Physics values a ground of `type` starts with, before a written `P` is applied (spec: S.P).

#### `normalizeGroundPhysics`

`function normalizeGroundPhysics(physics)`

The replacements the game makes before the physics uses a ground's values (docs/xml/grounds.md#physics-p): a `NaN`
friction becomes 0.2, a `NaN` mass, angle or damping 0, and a negative friction or restitution 0.

#### `decodeCollisionGroup`

`function decodeCollisionGroup(group, type = null)`

Collision group `c` -> collision category (docs/xml/grounds.md#collision): 0 -> 3 (4 for a cloud, T=8), 1 -> 3,
2 -> 4, 3 -> 5, anything else (4, and the 5 water and cobweb always get) -> 0. Categories 3 / 4 / 5 / 0 are
"mice and objects" / "objects only" / "mice only" / "neither".
<!-- END:api -->
