import {
  parseXml,
  elementChildren,
  attributeMap,
  hasAttribute,
} from "../xml/parse.js";
import { as3Int, as3Number, as3NumberOrZero, as3ParseFloat, as3ParseInt } from "./codecs.js";
import { findEditorViolations } from "./editor-limits.js";
import {
  OBJECT_FILTER, AREA_ATTRIBUTES, AREA_DEFAULTS, COLLISION_PRESETS, DYNAMIC_GROUND_DENSITY, DEFAULT_GRAVITY, bitsOf, clampGroundSize,
  decodeObjectType, groundConstructorPhysics, normalizeGroundPhysics, decodeCollisionGroup,
} from "./client-constants.js";
import { decodeModules, moduleAttributes } from "./modules/index.js";

const KNOWN_SETTINGS = new Set([
  "nosync", "theme", "mc", "dodue", "aie", "bh", "mgoc", "Ca", "G", "N", "C", "A", "F", "P",
  "shaman_tools", "defilante", "L", "H", "DS", "D", "d", "APS", "ARPS", "IP",
]);

const KNOWN_GROUND = new Set([
  "X", "Y", "L", "H", "T", "name", "target", "nosync", "c", "v", "m",
  "inputSpeedBonus", "outputSpeedBonus", "invertOutputPoint", "addInputGroundSpeed",
  "tint", "grav", "col", "lua", "contact", "friction", "i", "P", "o", "N",
  // Read for water (T=9) and cobweb (T=15) areas only; ignored on other types (docs/xml/grounds.md#area-physics-water-and-cobweb).
  "archAcc", "archMax", "archCheeseMax", "linDampAcc", "linDampMax", "angDampAcc", "angDampMax",
]);

// Attributes of Lua modules (src/tfm/modules/) are known too: they are decoded into `map.modules`.
const KNOWN_OBJECT = new Set(["C", "X", "Y", "nosync", "Mv", "Mp", "P", ...moduleAttributes("object")]);
const KNOWN_DECORATION = new Set(["X", "Y", "T", "C", "P", "D", "CT", ...moduleAttributes("decoration")]);
const KNOWN_JOINT = new Set(["M1", "M2", "P1", "P2", "P3", "P4", "HZ", "AMP", "AXIS", "A", "LIM1", "LIM2", "MV", "R", "c", "lua"]);
const KNOWN_PARTICLE = new Set(["id", "img", "dur", "int", "loop", "ori", "sp", "acc"]);

/**
 * Per scope (`settings`, `ground`, `object`, `decoration`, `joint`, `particle`) the set of attribute names the parser decodes. Anything else is kept in `unknownAttributes`.
 */
export const KNOWN_ATTRIBUTES = Object.freeze({
  settings: KNOWN_SETTINGS,
  ground: KNOWN_GROUND,
  object: KNOWN_OBJECT,
  decoration: KNOWN_DECORATION,
  joint: KNOWN_JOINT,
  particle: KNOWN_PARTICLE,
});

function attrs(node) {
  return attributeMap(node);
}


// Flash's legacy flash.xml.XMLDocument (ignoreWhite=false, its default) exposes element and text nodes in childNodes.
// Whitespace-only text between elements is therefore a real node that occupies a positional slot. CDATA surfaces as
// text. Comments/PIs are assumed to be dropped by the legacy parser (unverified in-game). docs/xml/values.md#text-between-tags
/**
 * Children of a node the way legacy `flash.xml.XMLNode.childNodes` lists them: elements and text/CDATA nodes. Used by `structureMode: "client-raw"`.
 */
export function legacyChildNodes(node) {
  return node?.children?.filter((child) => child.kind === "element" || child.kind === "text" || child.kind === "cdata") ?? [];
}

function textLikeCount(node) {
  return legacyChildNodes(node).filter((child) => child.kind !== "element").length;
}

const hasTextLike = (node) => node?.children?.some((c) => c.kind === "text" || c.kind === "cdata") ?? false;

function slotDiagnostics(root, zone, containers, rawStructure = false) {
  // Fast path: compact XML has no text/CDATA children anywhere that matters.
  if (!hasTextLike(root) && !hasTextLike(zone) && !containers.some(([, node]) => hasTextLike(node))) return [];
  const out = [];
  const rootNodes = legacyChildNodes(root);
  // A slot is "shifted" when a non-element sits in it and a real element comes after it.
  const shifted = (nodes, slots) => nodes.slice(0, slots).some((n, i) => n.kind !== "element" && nodes.slice(i + 1).some((m) => m.kind === "element"));
  if (shifted(rootNodes, 2)) {
    out.push({ code: "legacy-text-node-shifts-root-slot", severity: "client-quirk", offset: rootNodes[0].start ?? 0 });
  }
  const zoneNodes = legacyChildNodes(zone);
  if (shifted(zoneNodes, 4)) {
    out.push({ code: "legacy-text-node-shifts-zone-slot", severity: "client-quirk", offset: zoneNodes[0].start ?? 0 });
  }
  for (const [name, node] of containers) {
    const count = textLikeCount(node);
    if (count) out.push({ code: "legacy-text-node-phantom-entries", severity: "client-quirk", container: name, count, offset: node.start ?? 0 });
  }
  // Under the game's positional reading (text nodes occupy slots) the zone must be root child 1 and have at
  // least three child nodes, otherwise a container is missing and the map fails to load; the game then loads map 0.
  // structureMode "client-raw" already reports this through zone-missing / zone-container-missing.
  if (!rawStructure) {
    const rawZone = rootNodes[1];
    if (!(rawZone && legacyChildNodes(rawZone).length >= 3)) {
      out.push({ code: "text-node-breaks-positional-slots", severity: "client-error", offset: rootNodes.find((n) => n.kind !== "element")?.start ?? 0 });
    }
  }
  return out;
}

function keptAttributes(node, known, preserveUnknown) {
  const all = attrs(node);
  if (preserveUnknown || !known) return all;
  const out = Object.create(null);
  for (const name of known) if (Object.prototype.hasOwnProperty.call(all, name)) out[name] = all[name];
  return out;
}
function unknownAttributes(node, known, preserveUnknown) {
  if (!preserveUnknown || !node) return undefined;
  const out = {};
  for (const attr of node.attributes) if (!known.has(attr.name)) out[attr.name] = attr.value;
  return Object.keys(out).length ? out : undefined;
}

function sourceRef(node) {
  if (!node) return null;
  return { nodeId: node.id, rawName: node.name };
}


function parseSettings(node, options) {
  if (!node) return {
    source: null,
    width: null,
    height: null,
    attributes: {},
    images: { background: [], foreground: [], disappearing: [], appearing: [], ip: [] },
  };
  const a = attrs(node);
  // L and H are `truthy`, not `presence`: an empty value keeps the default size (docs/xml/settings.md#map-size).
  const width = a.L ? as3Int(a.L) : null;
  const height = a.H ? as3Int(a.H) : null;
  const gravityWind = parseGravityWind(a.G);
  const backgroundImages = parseDImages(a.D);

  return {
    source: sourceRef(node),
    width,
    height,
    backgroundImageId: hasAttribute(node, "F") ? as3Int(a.F) : null,
    wind: gravityWind?.wind ?? null,
    gravity: gravityWind?.gravity ?? null,
    // Values after the game's NaN replacement: wind 0, gravity 10 (spec: P.G).
    derived: gravityWind ? {
      wind: Number.isNaN(gravityWind.wind) ? 0 : gravityWind.wind,
      gravity: Number.isNaN(gravityWind.gravity) ? DEFAULT_GRAVITY : gravityWind.gravity,
    } : null,
    shamanObjectsMass: hasAttribute(node, "mgoc") ? as3Int(a.mgoc) : null,
    miceSpawn: parseMiceSpawn(a.DS),
    defilante: hasAttribute(node, "defilante") ? parseDefilante(a.defilante) : null,
    night: parseNight(a.N),
    theme: a.theme ?? null,
    // The game lower-cases the value and keeps it only when it equals "halloween" (spec: P.theme).
    themeHalloween: a.theme ? String(a.theme).toLowerCase() === "halloween" : false,
    portals: hasAttribute(node, "P"),
    collisions: hasAttribute(node, "C"),
    soulmate: hasAttribute(node, "A"),
    hideOffscreen: hasAttribute(node, "Ca"),
    hideNails: hasAttribute(node, "mc"),
    upwardsCannonballs: hasAttribute(node, "bh"),
    dodue: hasAttribute(node, "dodue"),
    aie: hasAttribute(node, "aie"),
    nosync: hasAttribute(node, "nosync"),
    shamanTools: parseShamanTools(a.shaman_tools),
    images: {
      background: backgroundImages,
      foreground: parseForegroundImages(a.d, backgroundImages),
      disappearing: parseEightFieldImageRecords(a.APS),
      appearing: parseEightFieldImageRecords(a.ARPS),
      ip: parseThreeFieldImageRecords(a.IP),
    },
    attributes: keptAttributes(node, KNOWN_SETTINGS, options.preserveUnknown),
    unknownAttributes: unknownAttributes(node, KNOWN_SETTINGS, options.preserveUnknown),
  };
}

function parseShamanTools(value) {
  if (!value) return null;
  const tools = String(value).split(",").map(as3Int).filter(Boolean);
  return tools.length ? tools : null;
}

function parseGravityWind(value) {
  if (value == null) return null;
  const p = String(value).split(",");
  return {
    raw: value,
    wind: as3Number(p[0]),
    gravity: as3Number(p[1]),
  };
}

function parseNight(value) {
  if (value == null) return null;
  const raw = String(value);
  // Night mode is on by `presence`, but the value is only decoded when it is not empty and has exactly one or two
  // comma fields (spec: P.N).
  if (raw === "") return { raw: value, diameter: null, type: null };
  const p = raw.split(",");
  if (p.length === 1) return { raw: value, diameter: as3Number(p[0]), type: null };
  if (p.length === 2) return { raw: value, diameter: as3Number(p[0]), type: as3Number(p[1]) };
  return { raw: value, diameter: null, type: null };
}

function parseDefilante(value) {
  if (value == null) return null;
  const p = String(value).split(",");
  const startSpeedRaw = p[0] ?? "";
  return {
    raw: value,
    startSpeedRaw,
    // Values stay in the units of the XML; the game's /36 and /360 run-time scaling is left to emulation (spec: P.defilante).
    startSpeed: Math.max(0, as3Int(startSpeedRaw)),
    accelerationRaw: p[1] ?? null,
    maxSpeedRaw: p[2] ?? null,
    acceleration: as3NumberOrZero(p[1]),
    maxSpeed: as3NumberOrZero(p[2]),
    freeScroll: p[3] === "1",
  };
}

function parseMiceSpawn(value) {
  if (!value) return null;
  const fields = String(value).split(";");
  if (fields.length !== 2) {
    return { type: "unknown", selector: fields[0] ?? "", payload: fields[1] ?? "", extra: fields.slice(2), raw: value };
  }
  const [kind, payload = ""] = fields;
  const extra = [];
  if (kind === "m") {
    // At most 40 fields are read, an odd count drops its last field (docs/xml/settings.md#mouse-spawn-ds).
    const fields = payload.split(",");
    let n = Math.min(fields.length, 40);
    if (n % 2 === 1) n -= 1;
    const positions = [];
    for (let i = 0; i < n; i += 2) positions.push({ x: as3Int(fields[i]), y: as3Int(fields[i + 1]) });
    return { type: "multiple", positions, raw: value, extra, ignoredFields: fields.length - n };
  }
  if (kind === "x" || kind === "y") {
    return { type: "random", axis: kind, position: as3Int(payload), raw: value, extra };
  }
  if (kind === "r") {
    const p = payload.split(",");
    return {
      type: "rectangle",
      x: as3Int(p[0]), y: as3Int(p[1]), width: as3Int(p[2]), height: as3Int(p[3]),
      raw: value, extra,
    };
  }
  return { type: "unknown", selector: kind, payload, extra, raw: value };
}

function parseRepeatCount(value, convert) {
  if (value == null || value === "") return 0;
  if (Number.isNaN(as3Number(value))) return 0;
  const count = convert(value, 10);
  return Number.isNaN(count) ? 0 : count;
}

function parseDImages(value) {
  if (!value) return [];
  if (String(value).startsWith("#")) {
    const p = String(value).slice(1).split(",");
    // Width and height are parseInt(field, 10), then `int`, so NaN and missing values become 0. They are the size of
    // the tiled area, not a position (docs/xml/images.md#tiled-background).
    return [{
      kind: "special",
      specialType: "tiled-bitmap",
      value: p[0] ?? "",
      width: as3Int(as3ParseInt(p[1], 10)),
      height: as3Int(as3ParseInt(p[2], 10)),
      raw: value,
    }];
  }
  if (!String(value).includes(",")) return [{ kind: "image", url: String(value), x: 0, y: 0, repeatCount: 0, repeatArg: null, raw: value }];
  return String(value).split(";").map((entry) => {
    const p = entry.split(",");
    return {
      kind: "image",
      url: p[0] ?? "",
      x: as3Int(p[1]),
      y: as3Int(p[2]),
      repeatCount: parseRepeatCount(p[3], as3ParseInt),
      repeatArg: p[4] ?? null,
      raw: entry,
    };
  });
}

function parseForegroundImages(value, backgroundImages = []) {
  if (!value) return [];
  if (!String(value).includes(",")) return [{ kind: "image", url: String(value), x: 0, y: 0, repeatCount: 0, repeatArg: null, raw: value }];
  const result = [];
  // The repeat offset of a `d` record is field 5 of the last `D` tuple, not of its own tuple: a bug of the game,
  // reproduced on purpose (docs/xml/images.md#repeats).
  const clientRepeatArg = [...backgroundImages].reverse().find((entry) => entry.kind === "image")?.repeatArg ?? null;
  for (const group of String(value).split(";")) {
    const p = group.split(",");
    for (let i = 0; i < p.length; i += 4) {
      result.push({
        kind: "image",
        url: p[i] ?? "",
        x: as3Int(p[i + 1]),
        y: as3Int(p[i + 2]),
        repeatCount: parseRepeatCount(p[i + 3], as3Int),
        repeatArg: clientRepeatArg,
        raw: p.slice(i, i + 4).join(","),
      });
    }
  }
  return result;
}

// `sp` / `acc`: "xFrom,xTo;yFrom,yTo". Each particle the game emits takes a random value between `from` and `to` on each axis;
// a group with one number uses it for both (docs/xml/particles.md#how-the-game-emits-particles).
const ZERO_RANGE = Object.freeze({ from: 0, to: 0 });
function parseParticleRanges(value) {
  const raw = String(value);
  const groups = raw.split(";");
  const range = (group) => {
    const p = String(group).split(",");
    const from = as3Number(p[0]);
    return { from, to: p.length > 1 ? as3Number(p[1]) : from };
  };
  // The game decides whether the y group exists from the length of the whole value, not from the number of groups: a value
  // longer than one character without `;` makes the map fail to load (spec: particles/*.sp).
  const secondGroupMissing = raw.length > 1 && groups[1] == null;
  return {
    x: range(groups[0]),
    y: raw.length > 1 && groups[1] != null ? range(groups[1]) : { ...ZERO_RANGE },
    raw,
    secondGroupMissing,
  };
}

function parseParticle(node, options) {
  const a = attrs(node);
  const id = a.id ?? null;
  const rawId = id == null ? null : String(id);
  const idIsHex = rawId?.startsWith("#") ?? false;
  const idValue = rawId == null
    ? null
    : idIsHex
      ? as3ParseInt(rawId.slice(1), 16)
      : as3Int(rawId);
  // `ori` is where the particles start: two `int` fields (spec: particles/*.ori).
  const ori = a.ori ? String(a.ori).split(",") : null;
  const position = ori ? { x: as3Int(ori[0]), y: as3Int(ori[1]), raw: String(a.ori) } : null;
  const speed = a.sp ? parseParticleRanges(a.sp) : null;
  const acceleration = a.acc ? parseParticleRanges(a.acc) : null;
  const ranges = (r) => ({ x: r ? { from: r.x.from, to: r.x.to } : { ...ZERO_RANGE }, y: r ? { from: r.y.from, to: r.y.to } : { ...ZERO_RANGE } });

  return {
    source: sourceRef(node),
    rawName: node.name,
    id: rawId,
    idValue,
    idIsHex,
    image: hasAttribute(node, "img") ? a.img : null,
    // `int` of the attribute, so an absent dur or int is 0, not a default. `derived.duration` applies the game's
    // 10000 cap (spec: particles/*.dur).
    duration: as3Int(a.dur),
    // The game creates no particle whose `id` is empty or absent (spec: particles/*.id).
    clientCreated: Boolean(rawId),
    interval: as3Int(a.int),
    loop: a.loop === "1",
    position,
    orientation: position, // the earlier name of `position`
    speed,
    acceleration,
    // What the game emits with: absent values are 0 (docs/xml/particles.md#how-the-game-emits-particles).
    derived: {
      duration: Math.min(as3Int(a.dur), 10000),
      position: { x: position?.x ?? 0, y: position?.y ?? 0 },
      speed: ranges(speed),
      acceleration: ranges(acceleration),
    },
    attributes: keptAttributes(node, KNOWN_PARTICLE, options.preserveUnknown),
    unknownAttributes: unknownAttributes(node, KNOWN_PARTICLE, options.preserveUnknown),
  };
}

function parseEightFieldImageRecords(value) {
  if (!value) return [];
  return String(value).split(";")
    .map((entry) => entry.split(","))
    .filter((p) => p.length === 8)
    .map((p) => {
      const mode = as3Int(p[1]);
      const x = as3Int(p[2]);
      const y = as3Int(p[3]);
      const width = as3Int(p[4]);
      const height = as3Int(p[5]);
      const imageX = as3Int(p[6]);
      const imageY = as3Int(p[7]);
      return {
        url: p[0],
        mode,
        modeIsZero: mode === 0,
        rect: { x, y, width, height, right: as3Int(x + width), bottom: as3Int(y + height) },
        imagePosition: { x: imageX, y: imageY },
        fields: p,
        raw: p.join(","),
      };
    });
}

function parseThreeFieldImageRecords(value) {
  if (!value) return [];
  return String(value).split(";").map((entry) => entry.split(",")).filter((p) => p.length === 3).map((p) => ({ kind: "image", url: p[0], x: as3Int(p[1]), y: as3Int(p[2]), raw: p.join(",") }));
}

// The reading of the third-party editor Miceditor: left >= 0 sticky (value left * 5), otherwise slippery (value -left);
// duration = left / right. Either number NaN -> "glitched". How the game uses the pair has not been seen
// (docs/xml/grounds.md#honey).
function decodeHoney(left, right) {
  if (Number.isNaN(left) || Number.isNaN(right)) return { type: "glitched", value: null, duration: null };
  const sticky = left >= 0;
  return { type: sticky ? "sticky" : "slippery", value: sticky ? left * 5 : left * -1, duration: left / right };
}

function imageParts(value) {
  if (!value) return null;
  const fields = String(value).split(",");
  if (fields.length < 3) return null;
  return { x: as3Int(fields[0]), y: as3Int(fields[1]), url: fields[2], fields };
}

function decodeAreaPhysics(a) {
  const out = {};
  for (const name of AREA_ATTRIBUTES) out[name] = a[name] ? as3Number(a[name]) : null;
  return out;
}

/**
 * The area of a water (T=9) or cobweb (T=15) ground: the type's defaults overlaid with the area attributes (`number`
 * when truthy). The rectangle: left = floor(x - L / 2) (ceil in a mirrored room, a run-time option not applied here),
 * right = left + L, top = y - H / 2, bottom = top + H, with L and H kept in [10, 4000]
 * (docs/xml/grounds.md#area-physics-water-and-cobweb).
 */
function decodeArea(type, a, x, y, width, height) {
  const physics = { ...AREA_DEFAULTS[type] };
  for (const name of AREA_ATTRIBUTES) if (a[name]) physics[name] = as3Number(a[name]);
  const left = Math.floor(x - width / 2);
  const top = y - height / 2;
  return { kind: type === 9 ? "water" : "cobweb", rect: { left, right: left + width, top, bottom: top + height }, physics };
}

/** Collision preset -> exact category bit, mask bits and the category bits the mask accepts (docs/xml/grounds.md#collision). */
function decodeCollisionFilter(preset) {
  const entry = COLLISION_PRESETS[preset];
  return { preset, categoryBits: entry.categoryBits, maskBits: entry.maskBits, collidesWithBits: bitsOf(entry.maskBits) };
}

function parseGround(node, options) {
  const a = attrs(node);
  const type = as3Int(a.T);
  const physicsRaw = a.P ?? null;
  // Water (T=9) ignores `P` (spec: S.P).
  const p = a.P && type !== 9 ? a.P.split(",") : null;
  const friction = a.friction ? a.friction.split(",") : null;
  const packedPhysics = p ? {
    dynamic: p[0] === "1",
    mass: as3Number(p[1]),
    // Field order: docs/xml/grounds.md#physics-p (fields 3 and 4 being friction and restitution is inferred).
    friction: as3Number(p[2]),
    restitution: as3Number(p[3]),
    rotation: as3Number(p[4]),
    fixedRotation: p[5] === "1",
    linearDamping: as3Number(p[6]),
    angularDamping: as3Number(p[7]),
  } : null;
  const defaultPhysics = groundConstructorPhysics(type);
  const effectivePhysics = packedPhysics ? { ...packedPhysics } : defaultPhysics;
  return {
    source: sourceRef(node),
    type,
    x: as3Int(a.X),
    y: as3Int(a.Y),
    width: as3Int(a.L),
    height: as3Int(a.H),
    name: a.name ?? null,
    target: a.target ?? null,
    // The collision group; water (T=9) and cobweb (T=15) always get 5 (docs/xml/grounds.md#collision).
    // `colorCode` is the legacy name.
    collisionGroup: as3Int(a.c),
    colorCode: as3Int(a.c),
    // Miceditor names `v` "vanish" and `m` "invisible". `variant` and `mobile` are the original guesses and are
    // kept as aliases.
    vanish: as3Int(a.v),
    variant: as3Int(a.v),
    invisible: hasAttribute(node, "m"),
    mobile: hasAttribute(node, "m"),
    nosync: hasAttribute(node, "nosync"),
    inputSpeedBonus: hasAttribute(node, "inputSpeedBonus") ? safeFloat(a.inputSpeedBonus) : null,
    outputSpeedBonus: hasAttribute(node, "outputSpeedBonus") ? safeFloat(a.outputSpeedBonus) : null,
    invertOutputPoint: hasAttribute(node, "invertOutputPoint"),
    addInputGroundSpeed: hasAttribute(node, "addInputGroundSpeed"),
    tint: hasAttribute(node, "tint") ? as3Int(as3ParseInt(a.tint, 16)) : null,
    gravity: hasAttribute(node, "grav") ? as3Number(a.grav) : null,
    collision: hasAttribute(node, "col"),
    touchCollision: hasAttribute(node, "col"), // Miceditor name
    lua: hasAttribute(node, "lua") ? as3Number(a.lua) : null,
    luaRaw: hasAttribute(node, "lua") ? a.lua : null,
    contact: hasAttribute(node, "contact") ? as3Int(a.contact) : null,
    // The `friction="a,b"` ATTRIBUTE is not the friction coefficient but honey (docs/xml/grounds.md#honey).
    // The `friction` field keeps the raw pair.
    friction: friction ? { x: as3Number(friction[0]), y: as3Number(friction[1]) } : null,
    honey: friction ? decodeHoney(as3Number(friction[0]), as3Number(friction[1])) : null,
    image: a.i ?? null,
    // `x,y,url`: x and y are `int`; fewer than 3 fields -> no image (spec: S.i).
    imageParts: imageParts(a.i),
    physicsRaw,
    physics: packedPhysics ? { ...packedPhysics, raw: a.P } : null,
    color: a.o ? as3Int(`0x${a.o}`) : null,
    foreground: hasAttribute(node, "N"),
    // The values the game works with once the ground is built (docs/xml/grounds.md).
    derived: {
      foreground: hasAttribute(node, "N") || type === 9 || type === 15 || type === 21,
      collisionGroup: type === 9 || type === 15 ? 5 : as3Int(a.c),
      gravityScale: hasAttribute(node, "grav") ? as3Number(a.grav) : 1,
      tint: hasAttribute(node, "tint") ? as3Int(as3ParseInt(a.tint, 16)) : 0x808080,
      packedPhysicsApplies: type !== 9,
      // Who collides, decoded from the collision group (docs/xml/grounds.md#collision).
      collision: decodeCollisionGroup(type === 9 || type === 15 ? 5 : as3Int(a.c), type),
      // L and H kept in [10, 4000].
      width: clampGroundSize(as3Int(a.L)),
      height: clampGroundSize(as3Int(a.H)),
      // The seven area attributes, read for water (T=9) and cobweb (T=15) only: `number` of each when truthy.
      areaPhysics: type === 9 || type === 15 ? decodeAreaPhysics(a) : null,
      // The full area (defaults + attributes + rectangle); null for every other type.
      area: type === 9 || type === 15 ? decodeArea(type, a, as3Int(a.X), as3Int(a.Y), clampGroundSize(as3Int(a.L)), clampGroundSize(as3Int(a.H))) : null,
      // The collision preset every shape of this ground gets (exact category and mask bits).
      collisionFilter: decodeCollisionFilter(decodeCollisionGroup(type === 9 || type === 15 ? 5 : as3Int(a.c), type).category),
      // What the physics body is built from. Only a DYNAMIC ground (packed P field 1 = "1") gets a body definition, so mass,
      // damping, fixed rotation and `grav` have no effect on a static ground; friction and restitution apply to both.
      dynamicBody: effectivePhysics.dynamic ? (() => {
        const final = normalizeGroundPhysics(effectivePhysics);
        return {
          massMode: final.mass ? "explicit" : "computed-from-shapes",
          mass: final.mass,
          inertia: final.mass ? final.mass / 10 : null,
          density: DYNAMIC_GROUND_DENSITY,
          linearDamping: final.linearDamping,
          angularDamping: final.angularDamping,
          fixedRotation: final.fixedRotation,
          gravityScale: hasAttribute(node, "grav") ? as3Number(a.grav) : 1,
        };
      })() : null,
      physics: {
        // The type's starting values, before `P` (the game's random jitter below 1e-6 is not applied).
        defaults: defaultPhysics,
        // `P` instead of the defaults (NaN kept when a field is missing); water (T=9) never uses `P`.
        effective: effectivePhysics,
        // `effective` after the game's replacements of NaN and negative values; what the physics uses
        // (docs/xml/grounds.md#physics-p).
        normalized: normalizeGroundPhysics(effectivePhysics),
      },
    },
    attributes: keptAttributes(node, KNOWN_GROUND, options.preserveUnknown),
    unknownAttributes: unknownAttributes(node, KNOWN_GROUND, options.preserveUnknown),
  };
}

function safeFloat(value) {
  const n = as3ParseFloat(value);
  return Number.isNaN(n) ? 0 : n;
}

function parseDecoration(node, options) {
  const a = attrs(node);
  const result = {
    source: sourceRef(node),
    kind: node.name,
    type: node.name === "P" ? as3Int(a.T) : node.name,
    x: as3Int(a.X),
    y: as3Int(a.Y),
    attributes: keptAttributes(node, KNOWN_DECORATION, options.preserveUnknown),
    unknownAttributes: unknownAttributes(node, KNOWN_DECORATION, options.preserveUnknown),
  };

  if (node.name === "T" || node.name === "F") {
    result.foreground = hasAttribute(node, "D");
    result.role = node.name === "T" ? "hole" : "cheese";
    // Miceditor calls CT the hole colour (values "", "1", "2"); `holeType` is the original name (spec: D/T.CT).
    if (node.name === "T") { result.holeType = hasAttribute(node, "CT") ? as3Int(a.CT) : 0; result.holeColor = result.holeType; }
  } else if (node.name === "DS") {
    result.role = "mouse-spawn";
  } else if (node.name === "DC") {
    result.role = "shaman-spawn";
  } else if (node.name === "DC2") {
    result.role = "dual-shaman-spawn";
  } else if (node.name === "P") {
    result.role = "decoration";
    const packed = String(a.P ?? "").split(",");
    const reverseCode = as3Int(packed[1]);
    result.foreground = packed[0] === "1";
    result.inversionCode = reverseCode;
    // 1 always flips horizontally, 2 flips with 50% probability each time the decoration is drawn, every other code
    // does not flip. The parser exposes the policy but does not perform the random draw (spec: D/P.P).
    result.reverse = reverseCode === 1 ? true : reverseCode === 2 ? "random" : false;
    result.colors = a.C ? String(a.C).split(",") : [];
    result.packed = a.P ?? null;
  }
  return result;
}

// In defilante mode (settings `defilante` present) the game turns these object types into markers (kinds 0..3)
// instead of shaman objects: C 6 -> 0, 32 -> 1, 15 -> 2, 16 -> 3 (docs/xml/settings.md#defilante).
const DEFILANTE_MARKER_KIND = new Map([[6, 0], [32, 1], [15, 2], [16, 3]]);

function parseObject(node, options, defilanteMode = false) {
  const a = attrs(node);
  const packed = a.P ? String(a.P).split(",") : null;
  // An object is solid unless `P` has a second field that is exactly "1" (docs/xml/objects.md#ghosts).
  const solid = packed?.length > 1 ? packed[1] !== "1" : true;
  const ghost = !solid;
  const hasMotion = Boolean(a.Mv);
  return {
    source: sourceRef(node),
    type: as3Int(a.C),
    x: as3Int(a.X),
    y: as3Int(a.Y),
    nosync: hasAttribute(node, "nosync"),
    speed: hasMotion ? as3Number(a.Mv) : null,
    power: hasMotion ? as3Number(a.Mp) : null,
    rotation: packed ? as3Int(packed[0]) : 0,
    ghost,
    packed: a.P ?? null,
    // docs/xml/objects.md#type-and-skin-c
    ...decodeObjectType(as3Int(a.C)),
    // The game creates no shaman object for these base types (docs/xml/objects.md#which-objects-exist).
    clientFiltered: OBJECT_FILTER.has(decodeObjectType(as3Int(a.C)).baseType),
    // Non-null only when settings.defilante is present; such nodes are not shaman objects in the game.
    defilanteMarker: defilanteMode ? (DEFILANTE_MARKER_KIND.get(as3Int(a.C)) ?? null) : null,
    attributes: keptAttributes(node, KNOWN_OBJECT, options.preserveUnknown),
    unknownAttributes: unknownAttributes(node, KNOWN_OBJECT, options.preserveUnknown),
  };
}

function parsePointRaw(value) {
  if (value == null) return null;
  const raw = String(value);
  const p = raw.split(",");
  return {
    raw,
    // Both components are `int`. The game's run-time /30 scaling and mirroring are not applied by the parser
    // (spec: L/*.P1).
    x: as3Int(p[0]),
    y: as3Int(p[1]),
    extra: p.length > 2 ? p.slice(2) : [],
  };
}

function parseJointStyle(value) {
  if (!value) return null;
  const p = String(value).split(",");
  return {
    raw: value,
    color: as3Int(`0x${p[0]}`),
    thickness: p.length >= 2 ? as3Int(p[1]) : 1,
    alphaRaw: p.length >= 3 ? p[2] : null,
    alpha: p.length >= 3 ? as3NumberOrZero(p[2]) : 1,
    foreground: p.length >= 4 ? p[3] === "1" : false,
  };
}

function parseJointMotor(value) {
  if (!value) return null;
  const p = String(value).split(",");
  return {
    raw: value,
    power: as3Number(p[0]),
    speed: as3Number(p[1]),
  };
}

function parseJoint(node, options) {
  const a = attrs(node);
  const common = {
    source: sourceRef(node),
    kind: node.name,
    m1: as3Int(a.M1),
    m2: as3Int(a.M2),
    p1: parsePointRaw(a.P1),
    color: a.c ?? null,
    style: parseJointStyle(a.c),
    lua: hasAttribute(node, "lua") ? a.lua : null,
    attributes: keptAttributes(node, KNOWN_JOINT, options.preserveUnknown),
    unknownAttributes: unknownAttributes(node, KNOWN_JOINT, options.preserveUnknown),
  };
  // The joint's Lua id is 0 unless `lua` is written (spec: L/*.lua).
  const clientLuaId = hasAttribute(node, "lua") ? as3Int(a.lua) : 0;
  switch (node.name) {
    case "JD": return {
      ...common,
      clientLuaId,
      p2: parsePointRaw(a.P2),
      hzRaw: a.HZ ?? null,
      hz: as3NumberOrZero(a.HZ),
      ampRaw: a.AMP ?? null,
      amplitude: as3NumberOrZero(a.AMP),
      damping: as3NumberOrZero(a.AMP), // Miceditor name for AMP
      frequency: as3NumberOrZero(a.HZ), // Miceditor name for HZ
    };
    case "JP": return {
      ...common,
      clientLuaId,
      axisRaw: a.AXIS ?? null,
      axis: parsePointRaw(a.AXIS),
      angleRaw: a.A ?? null,
      angle: as3NumberOrZero(a.A),
      lim1: as3Number(a.LIM1),
      lim2: as3Number(a.LIM2),
      motorRaw: a.MV ?? null,
      motor: parseJointMotor(a.MV),
    };
    case "JPL": return { ...common, clientLuaId, p2: parsePointRaw(a.P2), p3: parsePointRaw(a.P3), p4: parsePointRaw(a.P4), ratio: Number.isNaN(as3Number(a.R)) ? 1 : as3Number(a.R) };
    case "JR": return { ...common, clientLuaId, lim1: as3Number(a.LIM1), lim2: as3Number(a.LIM2), motorRaw: a.MV ?? null, motor: parseJointMotor(a.MV) };
    default: return { ...common, unknown: true };
  }
}

// The game keeps the last joint it created. A joint-container child that is not JD/JP/JPL/JR creates nothing, but its
// `c` style and `lua` still apply to that previous joint (`lua` with no joint before it makes the map fail to load).
// Recorded here instead of changing the records (docs/xml/joints.md#children-that-are-not-joints).
function annotateJointCarry(joints, nodes) {
  let lastKnown = null;
  const diagnostics = [];
  joints.forEach((joint, index) => {
    if (!joint.unknown) { lastKnown = index; return; }
    const a = attrs(nodes[index]);
    const hasLua = hasAttribute(nodes[index], "lua");
    if (!joint.style && !hasLua) return;
    joint.staleCarry = {
      targetIndex: lastKnown,
      style: joint.style,
      clientLuaId: hasLua ? as3Int(a.lua) : null,
    };
    diagnostics.push({ code: "joint-unknown-tag-applies-to-previous", severity: "client-quirk", index, targetIndex: lastKnown });
    if (hasLua && lastKnown === null) diagnostics.push({ code: "joint-lua-before-any-joint", severity: "client-error", index });
  });
  return diagnostics;
}

// Conditions under which the game fails to load the map and loads map 0 instead (docs/xml/values.md#when-a-map-fails-to-load).
function clientErrorDiagnostics({ clientStructure, zoneNode, decorationsContainer, groundsContainer, objectsContainer, decorationNodes, settings, particles = [] }) {
  const out = [];
  const err = (code, extra = {}) => out.push({ code, severity: "client-error", ...extra });
  if (clientStructure) {
    // A missing zone always makes the map fail to load, even though the game has a fallback for it: its particle
    // scan then reads the missing zone.
    if (!zoneNode) err("zone-missing");
    else {
      if (!decorationsContainer) err("zone-container-missing", { slot: 1, container: "decorations" });
      if (!groundsContainer) err("zone-container-missing", { slot: 0, container: "grounds" });
      if (!objectsContainer) err("zone-container-missing", { slot: 2, container: "objects" });
    }
  }
  decorationNodes.forEach((node, index) => {
    if (node.name === "P" && !hasAttribute(node, "P")) err("decoration-p-attribute-missing", { index });
  });
  particles.forEach((particle, index) => {
    if (particle.speed?.secondGroupMissing) err("particle-group-missing", { index, attribute: "sp" });
    if (particle.acceleration?.secondGroupMissing) err("particle-group-missing", { index, attribute: "acc" });
  });
  const hasDTuple = settings.images.background.some((entry) => entry.kind === "image" && entry.raw?.includes?.(","));
  settings.images.foreground.forEach((entry, index) => {
    if (entry.repeatCount !== 0 && !hasDTuple && String(settings.attributes.d ?? "").includes(",")) {
      err("d-repeat-without-d-tuple", { index });
    }
  });
  return out;
}

function preserveUnknownChildren(container, consumedIds, preserveUnknown) {
  if (!preserveUnknown || !container) return [];
  return elementChildren(container)
    .filter((node) => !consumedIds.has(node.id))
    .map((node) => ({ source: sourceRef(node), attributes: attrs(node) }));
}

function collectExtensionData(options, visits) {
  if (!options.enableExtensions || !Array.isArray(options.extensions) || options.extensions.length === 0) return [];
  const out = [];
  for (const visit of visits) {
    for (const extension of options.extensions) {
      if (!extension || typeof extension.decode !== "function") continue;
      if (extension.scopes && !extension.scopes.includes(visit.scope)) continue;
      if (typeof extension.match === "function" && !extension.match(visit.node, visit)) continue;
      const value = extension.decode(visit.node, visit);
      if (value !== undefined) {
        out.push({
          extension: extension.name ?? "anonymous",
          scope: visit.scope,
          source: sourceRef(visit.node),
          value,
        });
      }
    }
  }
  return out;
}

/**
 * Parse Transformice map XML into source-semantic JSON.
 * Runtime limits, mirroring, map modes and feature gating are intentionally not applied.
 */
export function parseTfmDocument(source, userOptions = {}) {
  const options = {
    preserveUnknown: true,
    enableExtensions: true,
    extensions: [],
    structureMode: "client",
    ...userOptions,
  };
  const document = parseXml(source, { ...(options.lenient === undefined ? {} : { lenient: options.lenient }), ...options.xml });
  const root = document.root;
  const rootElements = elementChildren(root);

  // The game finds the containers by position. The default mode counts element nodes only, so formatting stays
  // harmless; "client-raw" counts text nodes too, as the game does (docs/xml/values.md#text-between-tags).
  const byName = (nodes, name) => nodes.find((node) => node.name === name) ?? null;
  const rawStructure = options.structureMode === "client-raw";
  // client-raw: exact legacy positional slots (text nodes occupy slots). A non-element in a
  // slot has no attributes/children, so it behaves as an absent element here.
  const slotElement = (nodes, index) => {
    const n = nodes[index];
    return n && n.kind === "element" ? n : null;
  };
  const rootSlots = rawStructure ? legacyChildNodes(root) : rootElements;
  let settingsNode = rawStructure ? slotElement(rootSlots, 0) : (rootElements[0] ?? null);
  let zoneNode = rawStructure ? slotElement(rootSlots, 1) : (rootElements[1] ?? null);
  if (options.structureMode === "named" || options.structureMode === "hybrid") {
    settingsNode = byName(rootElements, "P") ?? (options.structureMode === "hybrid" ? settingsNode : null);
    zoneNode = byName(rootElements, "Z") ?? (options.structureMode === "hybrid" ? zoneNode : null);
  }
  const zoneElements = elementChildren(zoneNode);
  const zoneSlots = rawStructure ? legacyChildNodes(zoneNode) : zoneElements;
  let groundsContainer = slotElement(zoneSlots, 0);
  let decorationsContainer = slotElement(zoneSlots, 1);
  let objectsContainer = slotElement(zoneSlots, 2);
  let jointContainer = slotElement(zoneSlots, 3)?.name === "L" ? slotElement(zoneSlots, 3) : null;
  if (options.structureMode === "named" || options.structureMode === "hybrid") {
    groundsContainer = byName(zoneElements, "S") ?? (options.structureMode === "hybrid" ? groundsContainer : null);
    decorationsContainer = byName(zoneElements, "D") ?? (options.structureMode === "hybrid" ? decorationsContainer : null);
    objectsContainer = byName(zoneElements, "O") ?? (options.structureMode === "hybrid" ? objectsContainer : null);
    jointContainer = byName(zoneElements, "L") ?? (options.structureMode === "hybrid" ? jointContainer : null);
  }
  // The game keeps the LAST zone child named "particles" (docs/xml/particles.md).
  const allParticleContainers = zoneElements.filter((n) => n.name === "particles");
  const particleContainers = allParticleContainers.length ? [allParticleContainers.at(-1)] : [];

  const grounds = elementChildren(groundsContainer).map((node) => parseGround(node, options));
  const decorations = elementChildren(decorationsContainer).map((node) => parseDecoration(node, options));
  const settings = parseSettings(settingsNode, options);
  const objects = elementChildren(objectsContainer).map((node) => parseObject(node, options, settings.defilante != null));
  const jointNodes = elementChildren(jointContainer);
  const joints = jointNodes.map((node) => parseJoint(node, options));
  const jointDiagnostics = annotateJointCarry(joints, jointNodes);
  const particles = particleContainers.flatMap((container) => elementChildren(container).map((node) => parseParticle(node, options)));
  const clientDiagnostics = clientErrorDiagnostics({
    clientStructure: options.structureMode === "client" || options.structureMode === "client-raw",
    zoneNode, decorationsContainer, groundsContainer, objectsContainer,
    decorationNodes: elementChildren(decorationsContainer), settings, particles,
  });
  const editorCheck = findEditorViolations(typeof source === "string" ? source : "");
  const allDiagnostics = [
    ...document.diagnostics,
    ...slotDiagnostics(root, zoneNode, [
      ["grounds", groundsContainer], ["decorations", decorationsContainer],
      ["objects", objectsContainer], ["joints", jointContainer],
    ], options.structureMode === "client-raw"),
    ...jointDiagnostics,
    ...clientDiagnostics,
    ...(settingsNode && hasAttribute(settingsNode, "PNJ") ? [{ code: "deprecated-attribute", severity: "info", scope: "settings", attribute: "PNJ" }] : []),
    ...(editorCheck.ok ? [] : [{ code: "editor-disallowed-characters", severity: "editor-limit", count: editorCheck.count, characters: editorCheck.characters.map((c) => c.char) }]),
  ];

  const consumedRoot = new Set([settingsNode?.id, zoneNode?.id].filter(Boolean));
  const consumedZone = new Set([
    groundsContainer?.id,
    decorationsContainer?.id,
    objectsContainer?.id,
    jointContainer?.id,
    ...particleContainers.map((n) => n.id),
  ].filter(Boolean));

  const extensionVisits = [];
  if (options.enableExtensions && Array.isArray(options.extensions) && options.extensions.length) {
    if (settingsNode) extensionVisits.push({ scope: "settings", node: settingsNode, semantic: null });
    for (const node of rootElements) extensionVisits.push({ scope: "root-child", node, semantic: null });
    for (const node of zoneElements) extensionVisits.push({ scope: "zone-child", node, semantic: null });
    elementChildren(groundsContainer).forEach((node, i) => extensionVisits.push({ scope: "ground", node, semantic: grounds[i] }));
    elementChildren(decorationsContainer).forEach((node, i) => extensionVisits.push({ scope: "decoration", node, semantic: decorations[i] }));
    elementChildren(objectsContainer).forEach((node, i) => extensionVisits.push({ scope: "object", node, semantic: objects[i] }));
    elementChildren(jointContainer).forEach((node, i) => extensionVisits.push({ scope: "joint", node, semantic: joints[i] }));
    particleContainers.flatMap(elementChildren).forEach((node) => extensionVisits.push({ scope: "particle", node, semantic: null }));
  }

  const map = {
    format: "tfm-map",
    version: 0,
    source: {
      rootName: root.name,
      rootNodeId: root.id,
      diagnostics: allDiagnostics,
      // false when the game would fail to load this map; it then loads default map 0.
      clientLoads: !allDiagnostics.some((d) => d.severity === "client-error"),
      // Characters the editor would refuse to save (see editor-limits.js). Informational only.
      editor: findEditorViolations(typeof source === "string" ? source : ""),
    },
    settings,
    grounds,
    decorations,
    objects,
    joints,
    particles,
    // What Lua modules make of the map (docs/xml/modules.md), one entry per module.
    modules: decodeModules({
      decorations: elementChildren(decorationsContainer).map((node, index) => ({ node, index })),
      objects: elementChildren(objectsContainer).map((node, index) => ({ node, index })),
    }),
    extensions: {
      unknown: options.preserveUnknown ? {
        rootChildren: preserveUnknownChildren(root, consumedRoot, true),
        zoneChildren: preserveUnknownChildren(zoneNode, consumedZone, true),
      } : undefined,
      decoded: collectExtensionData(options, extensionVisits),
    },
  };

  return { map, document };
}

/**
 * Parse Transformice map XML into semantic JSON that says what the XML says. Runtime limits, mirroring, map modes and feature gating of the game client are NOT applied (a renderer or client-emulation layer decides those after parsing). Never throws on map-level problems: they are reported as `map.source.diagnostics` and `map.source.clientLoads`.
 *
 * Options (all optional):
 * - `preserveUnknown` (default `true`): keep unknown attributes and nodes.
 * - `structureMode`: how the root, zone and containers are found.
 *   - `"client"` (default): positional **element** children, as the client does; text between tags does not shift slots.
 *   - `"client-raw"`: positional over legacy `childNodes`, so text nodes occupy slots, exactly as the game reads an un-compacted payload.
 *   - `"named"`: find `P/Z/S/D/O/L` by name (tool convenience).
 *   - `"hybrid"`: names first, positions as fallback.
 * - `extensions`: `[{ name, scopes, match(node), decode(node, context) }]` observers for custom tags. Scopes: `settings`, `root-child`, `zone-child`, `ground`, `decoration`, `object`, `joint`, `particle`. Results are stored apart from the core representation.
 * - `xml`: `{ allowDoctype: false, allowUnquotedAttributes: false, unknownEntity: "preserve" }`.
 *
 * @example
 * import { parseTfmMap } from "tfm-map-renderer";
 * const map = parseTfmMap(xml, { structureMode: "client" });
 * map.grounds[0].derived.dynamicBody;
 */
export function parseTfmMap(source, userOptions = {}) {
  return parseTfmDocument(source, userOptions).map;
}
