import { as3Int } from "../tfm/codecs.js";
import { DEFAULT_MARKER_STYLES, colorToHex, groundStyle } from "./default-assets.js";
import { GROUND_TEXTURE_RECIPES, TILE_SIZE } from "./ground-textures.js";
import { createTextureContext, renderTexturedGround, seededRandom, textureDefs } from "./ground-texture.js";
import { applyClientLimits, resolveClientLimits } from "./client-limits.js";
import { GHOST_COLOR_TRANSFORM, NAIL_TYPES, WORLD_NAIL_TYPES, gameCreatesObject, isDrawnGhost } from "./client-objects.js";
import { flashBlurPrimitives } from "../util/flash-blur.js";
import { attr, finiteOr, imageElement, resolveImage } from "./svg-util.js";
import { renderModules, resolveModuleOptions } from "./modules/index.js";
import { assetBox, createCuller } from "./cull.js";

/** The colour the game paints behind everything, the default room colour (docs/rendering.md#draw-order). */
export const DEFAULT_ROOM_COLOR = "#6a7495";
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 400;

function normalizeViewport(map, options) {
  const mapWidth = finiteOr(map.settings.width, DEFAULT_WIDTH);
  const mapHeight = finiteOr(map.settings.height, DEFAULT_HEIGHT);
  const viewport = options.viewport ?? { x: 0, y: 0, width: mapWidth, height: mapHeight };
  let width = finiteOr(viewport.width, mapWidth);
  let height = finiteOr(viewport.height, mapHeight);
  if (width <= 0 || height <= 0) throw new RangeError("SVG viewport width/height must be positive");
  // `maxViewport`: a soft size limit, the viewport is cut down from its top-left corner instead of failing.
  const max = options.maxViewport;
  const maxWidth = finiteOr(max?.width, Infinity);
  const maxHeight = finiteOr(max?.height, Infinity);
  if (maxWidth <= 0 || maxHeight <= 0) throw new RangeError("maxViewport width/height must be positive");
  const cropped = width > maxWidth || height > maxHeight;
  width = Math.min(width, maxWidth);
  height = Math.min(height, maxHeight);
  return {
    cropped,
    mapWidth,
    mapHeight,
    x: finiteOr(viewport.x, 0),
    y: finiteOr(viewport.y, 0),
    width,
    height,
  };
}

const ALL = () => true;

function renderMapImage(record, resolver, kind, visible = ALL) {
  const asset = resolveImage(resolver, record.url, kind, { record });
  if (!asset || !visible({ x: record.x, y: record.y, width: asset.width, height: asset.height })) return "";
  return imageElement(asset, record.x, record.y, {
    width: asset.width,
    height: asset.height,
    preserveAspectRatio: "none",
  });
}

function assetDimensions(asset) {
  const width = Number(asset?.width ?? asset?.dimensions?.width);
  const height = Number(asset?.height ?? asset?.dimensions?.height);
  return {
    width: Number.isFinite(width) && width > 0 ? width : null,
    height: Number.isFinite(height) && height > 0 ? height : null,
  };
}

function renderTiledBitmap(record, resolver, fallbackWidth, fallbackHeight, index, visible = ALL) {
  const targetWidth = record.width > 0 ? record.width : fallbackWidth;
  const targetHeight = record.height > 0 ? record.height : fallbackHeight;
  if (!(targetWidth > 0) || !(targetHeight > 0)) return "";
  if (!visible({ x: 0, y: 0, width: targetWidth, height: targetHeight })) return "";

  const asset = resolveImage(resolver, record.value, "tiled", {
    record,
    targetWidth,
    targetHeight,
  });
  if (!asset) return "";

  const { width: tileWidth, height: tileHeight } = assetDimensions(asset);
  if (!(tileWidth > 0) || !(tileHeight > 0)) return "";

  const clipId = `tiled-${index}`;
  const columns = Math.ceil(targetWidth / tileWidth);
  const rows = Math.ceil(targetHeight / tileHeight);
  const out = [`<defs><clipPath${attr("id", clipId)}><rect${attr("x", 0)}${attr("y", 0)}${attr("width", targetWidth)}${attr("height", targetHeight)}/></clipPath></defs>`];
  out.push(`<g${attr("clip-path", `url(#${clipId})`)}>`);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < columns; x++) {
      out.push(imageElement(asset, x * tileWidth, y * tileHeight, {
        width: tileWidth,
        height: tileHeight,
        preserveAspectRatio: "none",
      }));
    }
  }
  out.push("</g>");
  return out.join("");
}

function renderDImages(records, resolver, kind, fallbackWidth, fallbackHeight, skipImages = false, restricted = false, tiled = false, mirrored = false, visible = ALL) {
  const out = [];
  for (let index = 0; index < (records ?? []).length; index++) {
    const record = records[index];
    if (record.kind === "special" && record.specialType === "tiled-bitmap") {
      // Off by default: a tiled `D` background loads an external image over http, which the game was meant to allow for admins only
      // (some clients, the AIR runtime, still load it for module maps). The map keeps the record; `renderTiledBackgrounds: true` draws it anyway.
      if (restricted || !tiled) continue;
      out.push(renderTiledBitmap(record, resolver, fallbackWidth, fallbackHeight, index, visible));
      continue;
    }
    if (skipImages || record.kind !== "image" || !record.url) continue;
    const asset = resolveImage(resolver, record.url, "standard", { record, layer: kind });
    if (!asset) continue;
    const shown = (x, y) => visible({ x, y, width: asset.width, height: asset.height });
    if (shown(record.x, record.y)) out.push(imageElement(asset, record.x, record.y));
    const count = restricted ? 0 : Math.max(0, as3Int(record.repeatCount));
    const dx = Number(record.repeatArg);
    if (count > 0 && Number.isFinite(dx)) {
      // In a mirrored map the game mirrors only the first image (x := mapWidth - x, bitmap flipped); the clones are then moved by +dx from THAT x, so they walk
      // to the right on screen (docs/xml/images.md#repeats). Inside the mirrored picture (x -> mapWidth - x) that is a walk to the left (verified with images-1.xml in a mirrored room).
      for (let i = 1; i <= count; i++) {
        const x = record.x + (mirrored ? -dx : dx) * i;
        if (shown(x, record.y)) out.push(imageElement(asset, x, record.y));
      }
    }
  }
  return out.join("");
}

function groundGeometry(ground) {
  const width = finiteOr(ground.derived?.width, ground.width);
  const height = finiteOr(ground.derived?.height, ground.height);
  const rotation = finiteOr(ground.derived?.physics?.normalized?.rotation, finiteOr(ground.physics?.rotation, 0));
  return { x: finiteOr(ground.x, 0), y: finiteOr(ground.y, 0), width, height, rotation, circle: ground.type === 13 };
}

// A ground's picture sits at the ground's (x, y), rotated, and its content is offset by -floor(width / 2),
// -int(height / 2) (not for a circle). The `i` image is placed inside that content (docs/xml/images.md#ground-image-i).
function renderGroundImage(ground, geometry, resolver, mirrored = false) {
  const parts = ground.imageParts;
  if (!parts?.url) return "";
  const asset = resolveImage(resolver, parts.url, "bare-name", { ground, record: parts });
  if (!asset) return "";
  const ox = geometry.circle ? 0 : -(mirrored ? Math.ceil(geometry.width / 2) : Math.floor(geometry.width / 2));
  const oy = geometry.circle ? 0 : -Math.trunc(geometry.height / 2);
  return imageElement(asset, ox + finiteOr(parts.x, 0), oy + finiteOr(parts.y, 0));
}

/** Where `renderGroundImage` puts the image, in the ground's own coordinates. */
function groundImageBox(ground, geometry, resolver, mirrored = false) {
  const parts = ground.imageParts;
  const asset = resolveImage(resolver, parts.url, "bare-name", { ground, record: parts });
  const ox = geometry.circle ? 0 : -(mirrored ? Math.ceil(geometry.width / 2) : Math.floor(geometry.width / 2));
  const oy = geometry.circle ? 0 : -Math.trunc(geometry.height / 2);
  return { x: ox + finiteOr(parts.x, 0), y: oy + finiteOr(parts.y, 0), width: asset?.width, height: asset?.height };
}

/**
 * `APS` images: the game adds each one to the top layer when the map is built and draws the WHOLE image at (imageX, imageY); the 8-field
 * record's rectangle is not a clip (verified in the game with images-2.xml: the images show whole) but the area that, at run time, makes the image disappear.
 * `ARPS` images (the appearing ones) and `IP` images (portal pictures) are not in the picture at load time: an `ARPS` image fades in, inside the bottom layer, while the player's
 * point is inside its rectangle; an `IP` image is shown for 5 s by a server packet. They are drawn only on request (`renderAppearingImages`, `renderIpImages`),
 * as the state "shown", on top of the bottom layer (that is where the game adds them). docs/xml/images.md#images-in-the-settings
 */
function renderApsImages(records, resolver, layer = "aps", visible = ALL) {
  const out = [];
  for (const record of records ?? []) {
    if (!record?.url) continue;
    const asset = resolveImage(resolver, record.url, "bare-name", { record, layer });
    if (asset && visible({ ...record.imagePosition, width: asset.width, height: asset.height })) out.push(imageElement(asset, record.imagePosition.x, record.imagePosition.y));
  }
  return out.join("");
}

/**
 * The game's minimalist-mode look of a ground: a flat colour per type, none of the textures (docs/xml/grounds.md#ground-types).
 * Types without a flat colour (16 and above 21) keep the default style.
 */
function minimalistStyle(ground, own) {
  const flat = GROUND_TEXTURE_RECIPES[ground.type]?.flat;
  if (!flat) return null;
  if (flat.alpha === 0) return { fill: null };
  const fill = flat.color === "ground" ? own ?? "#ffffff" : colorToHex(flat.color);
  return { fill, ...(flat.alpha != null && flat.alpha !== 1 ? { opacity: flat.alpha } : {}) };
}

/**
 * The backgrounds a random-background map (`F="-2"`) picks from (0 appears twice; docs/xml/settings.md#background-f).
 * The game draws `$F_n` into an 800x400 bitmap and stretches it to max(map width, 800) x max(map height, 400)
 * at the bottom of the background layer; minimalist mode skips it.
 */
export const RANDOM_BACKGROUND_IDS = Object.freeze([0, 1, 2, 3, 0, 7]);

function renderMapBackground(map, resolver, options, mapWidth, mapHeight, visible = ALL) {
  let id = map.settings.backgroundImageId;
  if (id == null || id === -1 || options.minimalist === true) return "";
  const width = Math.max(mapWidth, 800);
  const height = Math.max(mapHeight, 400);
  // `F="-2"`: the client picks one of RANDOM_BACKGROUND_IDS at random, which a still picture cannot show. By default the picture is a composite: the
  // map is cut into vertical strips, one per distinct background of the client's list (0, 1, 2, 3 and 7), each showing its own part of that background.
  // `compositeRandomBackground: false` picks a single one instead (`randomBackgroundIndex`).
  if (id === -2 && options.compositeRandomBackground !== false) {
    const ids = [...new Set(RANDOM_BACKGROUND_IDS)];
    const strip = width / ids.length;
    return ids.map((n, i) => (visible({ x: i * strip, y: 0, width: strip, height })
      ? backgroundPicture(resolver, n, width, height, `map-background-clip-${i}`, i * strip, strip)
      : "")).join("");
  }
  if (id === -2) id = RANDOM_BACKGROUND_IDS[Math.abs(Math.trunc(options.randomBackgroundIndex ?? 0)) % RANDOM_BACKGROUND_IDS.length];
  return visible({ x: 0, y: 0, width, height }) ? backgroundPicture(resolver, id, width, height, "map-background-clip", 0, width) : "";
}

/** One `$F_<id>` clip stretched to width x height (the whole map), clipped to the vertical strip [clipX, clipX + clipWidth). */
function backgroundPicture(resolver, id, width, height, clipId, clipX, clipWidth) {
  const key = `$F_${id}`;
  const asset = resolveImage(resolver, key, "background", { key });
  if (!asset?.href) return "";
  const sx = width / 800;
  const sy = height / 400;
  const x = -(asset.origin?.x ?? 0) * sx;
  const y = -(asset.origin?.y ?? 0) * sy;
  return `<defs><clipPath${attr("id", clipId)}><rect${attr("x", clipX)}${attr("y", 0)}${attr("width", clipWidth)}${attr("height", height)}/></clipPath></defs>`
    + `<g${attr("clip-path", `url(#${clipId})`)}>${imageElement({ ...asset, width: (asset.width ?? 800) * sx, height: (asset.height ?? 400) * sy }, x, y, { preserveAspectRatio: "none" })}</g>`;
}

/**
 * Joints (docs/xml/joints.md#style-c): every joint whose `c` is non-empty is drawn as a line with `lineStyle(thickness, colour, alpha)` between
 * its two anchors (the points stay where the joint was made, since nothing moves in a still picture): `JD` from `P1` to `P2`, `JPL` (pulley) through the two
 * ground anchors, `A -> P3 -> P4 -> B`. `JP` / `JR` have two coinciding anchors, a line of zero length, which the game does not show (verified), so they draw nothing. A missing `P1` / `P2` is the centre of the ground `M1` / `M2` (a
 * `JP` uses `M1`'s, a `JR` uses `M2`'s: that is how the game builds the default; docs/xml/joints.md#anchors). A joint is dropped when either ground does not exist, when it is a Lua
 * joint (`lua`: the bodies come from Lua objects), when a pulley lacks `P3` or `P4`, and when it has no style (joints without `c` are invisible). The line
 * goes into the ground layer (under the grounds) or, when the fourth field of `c` is 1, into the top layer (under the foreground grounds).
 * @returns {{back: string, front: string}}
 */
function renderJoints(map) {
  const grounds = map.grounds ?? [];
  const back = [];
  const front = [];
  const centre = (index) => ({ x: finiteOr(grounds[index].x, 0), y: finiteOr(grounds[index].y, 0) });
  const pt = (p) => ({ x: finiteOr(p.x, 0), y: finiteOr(p.y, 0) });
  for (const joint of map.joints ?? []) {
    const style = joint.style;
    if (!style || joint.clientLuaId) continue;
    const a = grounds[joint.m1];
    const b = grounds[joint.m2];
    if (!a || !b) continue;
    let points;
    if (joint.kind === "JD") points = [joint.p1 ? pt(joint.p1) : centre(joint.m1), joint.p2 ? pt(joint.p2) : centre(joint.m2)];
    else if (joint.kind === "JPL") {
      if (!joint.p3 || !joint.p4) continue;
      points = [joint.p1 ? pt(joint.p1) : centre(joint.m1), pt(joint.p3), pt(joint.p4), joint.p2 ? pt(joint.p2) : centre(joint.m2)];
    } else if (joint.kind === "JP" || joint.kind === "JR") {
      continue; // two coinciding anchors: a zero-length line, not drawn by the game (verified with joints-1.xml)
    } else continue;
    if (points.every((p) => p.x === points[0].x && p.y === points[0].y)) continue; // zero length: the game draws nothing
    const thickness = Math.min(255, Math.max(0, finiteOr(style.thickness, 1)));
    const alpha = Math.min(1, Math.max(0, finiteOr(style.alpha, 1)));
    const d = points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join("");
    const path = `<path${attr("d", d)}${attr("fill", "none")}${attr("stroke", colorToHex(style.color))}${attr("stroke-width", thickness || 1)}`
      + `${alpha === 1 ? "" : attr("stroke-opacity", alpha)}${attr("stroke-linecap", "round")}${attr("stroke-linejoin", "round")}${attr("data-role", "joint")}${attr("data-kind", joint.kind)}/>`;
    (style.foreground ? front : back).push(path);
  }
  return { back: back.join(""), front: front.join("") };
}

function renderGrounds(map, resolver, defaults, minimalist = false, textures = null, pregeneratedForced = false, restricted = false, mirrored = false, visible = ALL) {
  // The game's layers, bottom to top: ... grounds, mice, objects, top (docs/rendering.md#draw-order). Grounds with the foreground
  // flag (the `N` attribute, and types 9, 15 and 21 always) go to the top layer, above the mice. The galaxy strip is added to the
  // grounds layer, so it ends up behind its own foreground ground and shows through that ground's transparent top.
  const base = [];
  const foreground = [];
  const strips = [];
  for (const ground of map.grounds ?? []) {
    // Minimalist mode only replaces the types that have a flat colour; the others (16, 22 and above) are drawn as usual (verified in the game).
    const flat = minimalist && Boolean(GROUND_TEXTURE_RECIPES[ground.type]?.flat);
    // `i` replaces the ground's own drawing (verified in the game, #Module room); for a restricted map `i` is ignored and the texture is drawn.
    const replaced = !restricted && Boolean(ground.imageParts?.url);
    const g = groundGeometry(ground);
    const own = ground.color != null ? colorToHex(ground.color) : null;
    // In a mirrored map the whole picture is flipped by an outer transform, but the game only mirrors a ground's position and rotation: its texture is never flipped
    // (verified: the edge pieces of the framed types stay on the same sides in `mirrored-3.xml`) and its picture is offset by -ceil(width / 2) instead of -floor(width / 2)
    // (docs/rendering.md#grounds). The counter-flip below cancels the outer one inside the ground, whose content is then drawn as in an unmirrored map.
    const transform = `translate(${g.x} ${g.y})${g.rotation ? ` rotate(${g.rotation})` : ""}${mirrored ? " scale(-1 1)" : ""}`;
    const ox = g.circle ? 0 : -(mirrored ? Math.ceil(g.width / 2) : Math.floor(g.width / 2));
    const oy = g.circle ? 0 : -Math.trunc(g.height / 2);
    const image = ground.invisible || restricted ? "" : renderGroundImage(ground, g, resolver, mirrored);
    // A ground wholly outside the viewport is left out, and so are the texture tiles outside it (they never reach resvg: cull.js).
    const place = { x: g.x, y: g.y, rotation: g.rotation, flip: mirrored };
    const r = Math.abs(g.width);
    const shapeBox = g.circle ? { x: -r, y: -r, width: 2 * r, height: 2 * r }
      : { x: Math.min(ox, -g.width / 2), y: Math.min(oy, -g.height / 2), width: g.width + 1, height: g.height + 1 };
    const shown = visible(shapeBox, place) || Boolean(image && visible(groundImageBox(ground, g, resolver, mirrored), place));
    // The texture of a culled ground is still built, with no cell drawn: the grounds share one random sequence, so the next
    // grounds get the same pieces as in a picture of the whole map.
    const textured = textures && !flat && !replaced && !ground.invisible && !g.circle
      ? renderTexturedGround(textures, {
        type: ground.type, width: g.width, height: g.height, tint: ground.derived?.tint ?? ground.tint ?? 0x808080,
        dynamic: Boolean(ground.derived?.physics?.dynamic ?? ground.physics?.dynamic), pregeneratedForced,
        cell: shown ? (col, row) => visible({ x: ox + col * TILE_SIZE, y: oy + row * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE }, place) : () => false,
      })
      : null;
    if (!shown) continue;
    let shape = "";
    if (textured) {
      shape = `<g${attr("transform", `translate(${ox} ${oy})`)}>${textured.base}</g>`;
      if (textured.strip) strips.push(`<g${attr("data-type", ground.type)}${attr("transform", transform)}><g${attr("transform", `translate(${-g.width / 2} ${-g.height / 2})`)}>${textured.strip}</g></g>`);
    } else {
      const style = (flat && minimalistStyle(ground, own)) || groundStyle(ground.type);
      const fill = defaults && !ground.invisible && !replaced ? (ground.type === 12 || ground.type === 13 ? own ?? style.fill : style.fill) : null;
      if (fill) {
        const opacity = style.opacity != null ? attr("fill-opacity", style.opacity) : "";
        shape = g.circle
          ? `<circle${attr("r", g.width)}${attr("fill", fill)}${opacity}/>`
          : `<rect${attr("x", -g.width / 2)}${attr("y", -g.height / 2)}${attr("width", g.width)}${attr("height", g.height)}${attr("fill", fill)}${opacity}/>`
            + (style.top ? `<rect${attr("x", -g.width / 2)}${attr("y", -g.height / 2)}${attr("width", g.width)}${attr("height", Math.min(style.top.height, g.height))}${attr("fill", style.top.fill)}${opacity}/>` : "");
      }
    }
    if (!shape && !image) continue;
    const element = `<g${attr("data-type", ground.type)}${attr("transform", transform)}>${shape}${image}</g>`;
    (ground.derived?.foreground ?? ground.foreground ? foreground : base).push(element);
  }
  return { base: base.join("") + strips.join(""), foreground: foreground.join("") };
}

/**
 * Hole and cheese clips as the game draws them (docs/xml/decorations.md#holes-and-cheese): `$Trou_Souris` for `T`, `$Fromage` (`$FromageDodue` with the `dodue` setting, plus the
 * lower-case theme, `halloween`, when the map has it) for `F`, registration point at (x, y); a theme with no matching clip draws nothing. The event cheese suffix (the game was running the
 * pumpkin event, `Citrouille`, on 2026-10-09 while the editor drew the plain cheese) is the option `cheeseSuffix`, empty by default;
 * it applies to `$Fromage` only, not to `$FromageDodue`. A hole
 * with `CT` 1 or 2 gets the game's glow (`GlowFilter(color, 1, 5, 5, 3, 3)`, cyan 0x98E2EB or pink 0xFEB1FC).
 */
const HOLE_GLOW_COLORS = Object.freeze({ 1: "#98e2eb", 2: "#feb1fc" });

function holeGlowFilter(type, flash = true) {
  // `GlowFilter(color, 1, 5, 5, 3, 3)`: blur 5 x 5, strength 3, quality 3 = three box blurs of width 5 (src/util/flash-blur.js); `flash: false` is the earlier Gaussian approximation.
  const blur = flash
    ? flashBlurPrimitives(5, 5, 3, "SourceAlpha", "b", "hb")
    : `<feGaussianBlur in="SourceAlpha" stdDeviation="2.5" result="b"/>`;
  return `<filter id="hole-glow-${type}" color-interpolation-filters="sRGB" x="-40%" y="-40%" width="180%" height="180%">`
    + `${blur}<feComponentTransfer in="b" result="s"><feFuncA type="linear" slope="3"/></feComponentTransfer>`
    + `<feFlood flood-color="${HOLE_GLOW_COLORS[type]}" result="c"/><feComposite in="c" in2="s" operator="in" result="g"/>`
    + `<feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
}

function holeCheeseSymbols(map, decoration, cheeseSuffix = "") {
  if (decoration.role === "hole") return { base: "$Trou_Souris", themed: "$Trou_Souris" };
  if (decoration.role !== "cheese") return null;
  const base = map.settings.dodue ? "$FromageDodue" : `$Fromage${cheeseSuffix}`; // the event suffix is not applied to `$FromageDodue`
  return { base, themed: map.settings.themeHalloween ? `${base}halloween` : base };
}

/** The glow filters the map's holes use, once per document (the base and the foreground pass both reference them). */
function holeGlowDefs(map, flash = true) {
  const types = new Set((map.decorations ?? []).filter((d) => d.role === "hole" && HOLE_GLOW_COLORS[d.holeType]).map((d) => d.holeType));
  return types.size ? `<defs>${[...types].sort().map((t) => holeGlowFilter(t, flash)).join("")}</defs>` : "";
}

/**
 * The clip the game shows for a hole or cheese. The game looks the themed name up in its libraries and gets an
 * EMPTY clip when no library defines it, so a theme without a matching clip draws nothing (verified: `theme="halloween"` without `dodue`
 * shows no cheese in the game). An HTML comment stands for that empty clip; an empty string means the resolver knows neither name (the
 * caller then draws a placeholder).
 */
function holeCheeseElement(map, decoration, resolver, cheeseSuffix = "") {
  const names = holeCheeseSymbols(map, decoration, cheeseSuffix);
  if (!names) return "";
  const draw = (key) => {
    const asset = resolveImage(resolver, key, "sprite", { decoration, key });
    if (!asset?.href) return "";
    const element = imageElement(asset, -(asset.origin?.x ?? 0), -(asset.origin?.y ?? 0));
    const glow = decoration.role === "hole" && HOLE_GLOW_COLORS[decoration.holeType] ? decoration.holeType : 0;
    return `<g${attr("transform", `translate(${finiteOr(decoration.x, 0)} ${finiteOr(decoration.y, 0)})`)}${attr("data-role", decoration.role)}${glow ? attr("filter", `url(#hole-glow-${glow})`) : ""}>${element}</g>`;
  };
  const themed = draw(names.themed);
  if (themed || names.themed === names.base) return themed;
  return resolveImage(resolver, names.base, "sprite", { decoration, key: names.base })?.href ? `<!-- empty clip: ${names.themed} is not defined -->` : "";
}

/**
 * In a mirrored map the outer transform flips the whole picture (positions and rotations follow). The holes and the cheese keep their own orientation (verified), as do the
 * grounds and the objects (their own counter-flips, see `renderGrounds` and `renderObjectAssets`); decorations are flipped by the game. `x` is the registration point; the element is flipped back around it.
 */
function keepUpright(element, x) {
  return `<g${attr("transform", `translate(${2 * x} 0) scale(-1 1)`)}>${element}</g>`;
}


/**
 * Placeholder marks (spawns always; holes and cheese when the resolver has no clip) plus the real hole and cheese clips, one entry
 * per decoration and layer (an empty string where the decoration is not in that layer). The game puts them in three layers
 * (docs/rendering.md#draw-order): `back` (the background layer, under the grounds) takes every non-foreground clip and all
 * placeholders; `ground` (the grounds layer, over the grounds, under the mice) takes the foreground holes; `objects` (the
 * objects layer, over the mice) takes the foreground cheese.
 */
/** The box culling holes, cheese and the placeholder marks: larger than any of their clips. */
const MARKER_BOX = Object.freeze({ x: -100, y: -100, width: 200, height: 200 });

function markerParts(map, resolver, { cheeseSuffix = "", spawnMarkers = "circles", mirrored = false, visible = ALL } = {}) {
  const layers = { back: [], ground: [], objects: [] };
  // `spawnMarkers: "editor"`: the in-game editor draws `AnimStatique` at a `DS` and `AnimStatiqueC` at a `DC`, and has no branch for
  // `DC2`: the loop then reuses the display object of the PREVIOUS node and only sets its x and y again, so a `DC2` right after a `DS` or `DC`
  // MOVES that clip to its own X/Y and draws nothing else (verified with markers-1: the clip of the DC appears at the DC2).
  const editorClips = new Map();
  let previousClip = null;
  (map.decorations ?? []).forEach((d, i) => {
    if (spawnMarkers !== "editor") return;
    const clip = d.role === "mouse-spawn" ? "AnimStatique" : d.role === "shaman-spawn" ? "AnimStatiqueC" : null;
    if (clip) { previousClip = { clip, x: d.x, y: d.y }; editorClips.set(i, previousClip); }
    else if (d.role === "dual-shaman-spawn" && previousClip) { previousClip.x = d.x; previousClip.y = d.y; }
    else previousClip = null;
  });
  const decorations = map.decorations ?? [];
  for (const [index, d] of decorations.entries()) {
    const parts = { back: "", ground: "", objects: "" };
    if (spawnMarkers === "none" || spawnMarkers === "editor") {
      const placed = editorClips.get(index);
      if (placed) {
        const asset = resolveImage(resolver, placed.clip, "sprite", { key: placed.clip });
        if (asset && visible(assetBox(asset), { x: finiteOr(placed.x, 0), y: finiteOr(placed.y, 0) })) parts.back = `<g${attr("transform", `translate(${finiteOr(placed.x, 0)} ${finiteOr(placed.y, 0)})`)}>${imageElement(asset, -(asset.origin?.x ?? 0), -(asset.origin?.y ?? 0))}</g>`;
      }
      if (d.role === "mouse-spawn" || d.role === "shaman-spawn" || d.role === "dual-shaman-spawn") {
        for (const layer of Object.keys(layers)) layers[layer].push(parts[layer]);
        continue;
      }
    }
    // Holes, cheese and their placeholders are small: a fixed box around the point decides (the clip is not looked up for a culled one).
    if (!visible(MARKER_BOX, { x: finiteOr(d.x, 0), y: finiteOr(d.y, 0) })) {
      for (const layer of Object.keys(layers)) layers[layer].push(parts[layer]);
      continue;
    }
    let real = (d.role === "hole" || d.role === "cheese") ? holeCheeseElement(map, d, resolver, cheeseSuffix) : "";
    if (real && mirrored) real = keepUpright(real, finiteOr(d.x, 0));
    if (real) {
      parts[!d.foreground ? "back" : d.role === "hole" ? "ground" : "objects"] = real;
    } else {
      const style = DEFAULT_MARKER_STYLES[d.role];
      if (style) {
        const x = finiteOr(d.x, 0);
        const y = finiteOr(d.y, 0);
        parts.back = style.rx
          ? `<ellipse${attr("cx", x)}${attr("cy", y)}${attr("rx", style.rx)}${attr("ry", style.ry)}${attr("fill", style.fill)}${attr("stroke", style.stroke)}${attr("data-role", d.role)}/>`
          : `<circle${attr("cx", x)}${attr("cy", y)}${attr("r", style.r)}${attr("fill", style.fill)}${attr("stroke", style.stroke)}${attr("data-role", d.role)}/>`;
      }
    }
    for (const layer of Object.keys(layers)) layers[layer].push(parts[layer]);
  }
  return layers;
}

function renderDebugMarkers(map) {
  const out = [];
  for (const decoration of map.decorations ?? []) {
    out.push(`<circle${attr("cx", decoration.x)}${attr("cy", decoration.y)}${attr("r", 5)}${attr("fill", "none")}${attr("stroke", "#ff00aa")}${attr("data-kind", decoration.kind)}/>`);
  }
  for (const object of map.objects ?? []) {
    out.push(`<rect${attr("x", object.x - 5)}${attr("y", object.y - 5)}${attr("width", 10)}${attr("height", 10)}${attr("fill", "none")}${attr("stroke", "#0066ff")}${attr("data-type", object.type)}/>`);
  }
  return out.join("");
}

/** Decorations that minimalist mode still draws (docs/xml/limits-and-modes.md#minimalist-mode). */
const MINIMALIST_DECORATIONS = new Set([89, 90, 131]);

/**
 * Decorations (docs/xml/decorations.md#decorations-p): the game draws the `$P_<type>` clip with its registration point at (x, y); inversion code 1 mirrors it around that
 * point and code 2 does so with probability 1/2. One entry per decoration. Non-foreground ones sit in the bottom layer
 * (under the grounds, in map order together with the holes and cheese), `foreground` ones in the top layer (over everything). An explicit `resolveDecorationAsset` callback replaces the default symbol lookup (and then draws every layer
 * in one go, unmirrored, in the bottom layer).
 */
function decorationParts(map, resolver, resolveDecorationAsset, { foreground = false, random = Math.random, minimalist = false, randomFlip = false, visible = ALL } = {}) {
  const custom = typeof resolveDecorationAsset === "function";
  return (map.decorations ?? []).map((decoration, index) => {
    if (custom && foreground) return "";
    if (!custom && (decoration.role !== "decoration" || Boolean(decoration.foreground) !== foreground)) return "";
    // Minimalist mode: only these live clips are still drawn.
    if (minimalist && !MINIMALIST_DECORATIONS.has(decoration.type)) return "";
    const source = custom ? resolveDecorationAsset(decoration, index) : `$P_${decoration.type}`;
    if (!source) return "";
    const asset = resolveImage(resolver, source, "sprite", { decoration, index, key: source, ...(!custom && decoration.colors?.length ? { colors: decoration.colors } : {}) });
    if (!asset) return "";
    const x = finiteOr(decoration.x, 0);
    const y = finiteOr(decoration.y, 0);
    if (custom) return visible({ x, y, width: asset.width, height: asset.height }) ? imageElement(asset, x, y) : "";
    const flip = decoration.inversionCode === 1 || (decoration.inversionCode === 2 && randomFlip && random() < 0.5);
    if (!visible(assetBox(asset), { x, y, flip })) return "";
    const element = imageElement(asset, -(asset.origin?.x ?? 0), -(asset.origin?.y ?? 0));
    return `<g${attr("transform", `translate(${x} ${y})${flip ? " scale(-1 1)" : ""}`)}>${element}</g>`;
  });
}

/**
 * Objects the game hides at first (the arrow `$Objet_0` fades in over its first frames) are shown the way the editor shows
 * them: this is the 1-based frame of the animation where they are fully visible.
 */
const OBJECT_EDITOR_FRAMES = Object.freeze({ 0: 12 });

/** Stand-in for an object that has no clip (the client draws nothing for these; Miceditor shows an "unknown object" tile). */
function objectPlaceholder(object) {
  return `<g${attr("transform", `translate(${finiteOr(object.x, 0)} ${finiteOr(object.y, 0)})`)}>`
    + `<rect${attr("x", -15)}${attr("y", -15)}${attr("width", 30)}${attr("height", 30)}${attr("fill", "none")}${attr("stroke", "#0066ff")}${attr("stroke-dasharray", "3 2")}${attr("data-type", object.type)}/>`
    + `<text${attr("y", 4)}${attr("font-size", 11)}${attr("text-anchor", "middle")}${attr("fill", "#0066ff")}>${object.type}</text></g>`;
}

/**
 * Shaman objects: the client's `$Objet_<type>` clips. A skinned object (`C` above 99) has its own clip named after the
 * whole `C` (the shaman-items bundle holds `$Objet_101`, `$Objet_1002`, ...); the base clip is the fallback. Defilante markers
 * are drawn as markers, not here. The clip is placed at its registration point, rotated by the first field of `P`; ghost
 * objects get the game's ghost colour transform (alpha 0.5, green and blue +40; docs/xml/objects.md#ghosts). An explicit `resolveObjectAsset` callback replaces the lookup
 * and draws the image unrotated.
 *
 * `mode`:
 * - `"editor"` (default) draws every object that has art, the way the in-game editor does, including the ones the game
 *   hides (nails, skills, the arrow from a frame where it is visible). Objects without a clip get a dashed placeholder with
 *   their type number unless `placeholders` is false.
 * - `"game"` draws what the game creates when the map is loaded (docs/xml/objects.md#which-objects-exist): only the types it
 *   creates, nails only when they join enough bodies (docs/xml/objects.md#nails), the arrow at its first (invisible) frame, and `C="28"` as a
 *   random one of the four balloons 28 to 31.
 */
function renderObjectAssets(map, resolver, resolveObjectAsset, { placeholders = true, mode = "editor", random = Math.random, mirrored = false, clientNails = false, visible = ALL } = {}) {
  const custom = typeof resolveObjectAsset === "function";
  const game = mode === "game";
  let ghostFilter = false;
  const assetOf = (object, index, type) => {
    const skin = type !== object.type ? 0 : object.skin;
    // The game draws the nails 112 and 113 as the plain red nail (verified in the game; the editor's chest and sack art for them is an editor bug).
    const candidates = type === 112 || type === 113 ? ["$Objet_11"] : skin > 0 ? [`$Objet_${type}`, `$Objet_${object.baseType}`] : [`$Objet_${type >= 100 ? object.baseType : type}`];
    const frame = game ? 1 : OBJECT_EDITOR_FRAMES[object.baseType] ?? 1;
    for (const key of candidates) {
      const asset = resolveImage(resolver, key, "sprite", { object, index, key, frame });
      if (asset) return asset;
    }
    return null;
  };
  // Game mode: a nail is drawn only when the game finds enough bodies under its point (grounds are not bodies for it): the nails
  // 11, 12, 13, 112 and 113 attach to the world, so one object is enough; 14, 15, 16 and 22 need two. A body is approximated by the
  // bounding box of its clip, turned by its rotation.
  const bodies = [];
  if (game && !custom && (map.objects ?? []).some((o) => NAIL_TYPES.has(o.type))) {
    (map.objects ?? []).forEach((object, index) => {
      if (object.defilanteMarker != null || !gameCreatesObject(object.baseType, object.type)) return;
      const asset = assetOf(object, index, object.type === 28 ? 28 : object.type);
      if (!asset) return;
      const w = Number(asset.width), h = Number(asset.height);
      if (!(w > 0 && h > 0)) return;
      bodies.push({ x: finiteOr(object.x, 0), y: finiteOr(object.y, 0), angle: finiteOr(object.rotation, 0) * Math.PI / 180, left: -(asset.origin?.x ?? 0), top: -(asset.origin?.y ?? 0), w, h });
    });
  }
  /** Indices (in object order) of the bodies under a point. */
  const bodiesUnder = (x, y) => bodies.map((b, i) => {
    const dx = x - b.x, dy = y - b.y;
    const c = Math.cos(-b.angle), sn = Math.sin(-b.angle);
    const lx = dx * c - dy * sn, ly = dx * sn + dy * c;
    return lx >= b.left && lx <= b.left + b.w && ly >= b.top && ly <= b.top + b.h ? i : -1;
  }).filter((i) => i >= 0);
  // The nail joints (docs/xml/objects.md#nails): one joint per body for a world nail, one per consecutive pair for the others; the rotating nails
  // 12, 13, 15 and 16 count against a limit of 11 joints per map (one game mode is exempt, not modelled); the picture of a nail is added to its first body
  // unless that body already carries a world nail's picture, and not at all when the map has `mc` (hide anchors: no picture in the first 5 s, when all map nails are made).
  const COUNTED = new Set([12, 13, 15, 16]);
  let rotatingJoints = 0;
  const withPicture = new Set();
  const nailShown = (object) => {
    const world = WORLD_NAIL_TYPES.has(object.type);
    const hit = bodiesUnder(finiteOr(object.x, 0), finiteOr(object.y, 0));
    let joints = world ? hit.length : hit.length - 1;
    if (joints < 1) return false;
    if (COUNTED.has(object.type)) {
      joints = Math.min(joints, Math.max(0, 11 - rotatingJoints));
      rotatingJoints += joints;
      if (joints < 1) return false;
    }
    const carriers = world ? hit.slice(0, joints) : hit.slice(1, 1 + joints);
    let shown = false;
    for (const body of carriers) {
      if (withPicture.has(body)) continue;
      if (!map.settings.hideNails) {
        shown = true;
        if (world) withPicture.add(body);
      }
    }
    return shown;
  };
  const rows = (map.objects ?? []).map((object, index) => {
    if (custom) {
      const source = resolveObjectAsset(object, index);
      const asset = source ? resolveImage(resolver, source, "sprite", { object, index }) : null;
      return asset && visible({ x: object.x, y: object.y, width: asset.width, height: asset.height }) ? imageElement(asset, object.x, object.y) : "";
    }
    if (object.defilanteMarker != null) return "";
    if (game && NAIL_TYPES.has(object.type)) {
      if (clientNails && !nailShown(object)) return "";
    } else if (game && !gameCreatesObject(object.baseType, object.type)) return "";
    let type = object.type;
    if (game && type === 28) type = 28 + Math.floor(random() * 4);
    const asset = assetOf(object, index, type);
    const x = finiteOr(object.x, 0);
    const y = finiteOr(object.y, 0);
    if (!asset) return placeholders && !game && resolver?.resolve && visible({ x: -15, y: -15, width: 30, height: 30 }, { x, y }) ? objectPlaceholder(object) : "";
    const angle = finiteOr(object.rotation, 0);
    if (!visible(assetBox(asset), { x, y, rotation: angle, flip: mirrored })) return "";
    const element = imageElement(asset, -(asset.origin?.x ?? 0), -(asset.origin?.y ?? 0));
    const ghost = isDrawnGhost(object);
    if (ghost) ghostFilter = true;
    // Mirrored map: the client moves the object to the mirrored x and negates its rotation but never flips the picture (verified with mirrored-4.xml: balloons, bomb,
    // skinned objects and the anvil all keep their orientation). The outer flip is cancelled by a counter-flip of the content, after the rotation.
    return `<g${attr("transform", `translate(${x} ${y})${angle ? ` rotate(${angle})` : ""}${mirrored ? " scale(-1 1)" : ""}`)}${ghost ? attr("filter", "url(#object-ghost)") : ""}>${element}</g>`;
  });
  const { mul, add } = GHOST_COLOR_TRANSFORM;
  const defs = ghostFilter
    ? `<defs><filter id="object-ghost" color-interpolation-filters="sRGB" x="-10%" y="-10%" width="120%" height="120%"><feColorMatrix type="matrix" values="${[0, 1, 2, 3].map((i) => { const r = [0, 0, 0, 0, add[i] / 255]; r[i] = mul[i]; return r.map((v) => Math.round(v * 1e5) / 1e5).join(" "); }).join("  ")}"/></filter></defs>`
    : "";
  return defs + rows.join("");
}

/**
 * The part of the map `renderTfmSvg` draws with these options, in map units: `viewport` (default the whole map, after
 * `clientLimits`) cut down to `maxViewport`; `cropped` says whether it was.
 * @returns {{x:number, y:number, width:number, height:number, mapWidth:number, mapHeight:number, cropped:boolean}}
 */
export function renderedViewport(map, options = {}) {
  if (!map?.settings) throw new TypeError("renderedViewport expects a parsed TfmMap");
  const clientLimits = resolveClientLimits(options.clientLimits ?? (options.restricted === true ? "restricted" : "unrestricted"));
  return normalizeViewport(applyClientLimits(map, clientLimits), options);
}

/**
 * Size limits of the renderer (not of the game: the client has no size limit for a map loaded from XML, and saved
 * maps exist with a width of 1000000000). They guard the output size in pixels (viewport x scale), so a huge
 * map renders only when the caller picks a viewport/scale or raises the limit.
 */
export const DEFAULT_LIMITS = Object.freeze({ maxWidth: 16384, maxHeight: 16384 });

function assertWithinLimits(width, height, limits) {
  if (limits === false || limits === null) return;
  const maxWidth = limits?.maxWidth ?? DEFAULT_LIMITS.maxWidth;
  const maxHeight = limits?.maxHeight ?? DEFAULT_LIMITS.maxHeight;
  if (width > maxWidth || height > maxHeight) {
    throw new RangeError(`SVG output ${width}x${height} exceeds the renderer limits ${maxWidth}x${maxHeight}; pass a smaller viewport or scale, or raise options.limits (maxWidth/maxHeight, or limits: false to disable)`);
  }
}

/**
 * Deterministic SVG renderer baseline.
 *
 * It renders source geometry and all image records for which an AssetResolver
 * supplies an href. Without assets it falls back to built-in placeholders (grounds as plain
 * filled rectangles/circles, spawns, cheese and holes as simple marks); pass
 * `defaultAssets: false` to draw only what a resolver supplies. `renderTiledBackgrounds: true` draws the tiled `D` backgrounds (`#url,w,h`, external images: off by default). `backgroundColor` is the colour painted behind everything (default `DEFAULT_ROOM_COLOR`, the game's #6A7495, unless `defaultAssets` is false; `null`, `"none"` or `"transparent"` leave it transparent). `spawnMarkers` chooses how `DS`/`DC`/`DC2` are drawn: `"circles"` (default, simple dots), `"editor"` (the in-game editor's `AnimStatique`/`AnimStatiqueC` clips, including its `DC2` quirk) or `"none"` (the game draws none). It never fetches an external URL itself. Decorations and
 * shaman objects can be connected to extracted sprite assets through explicit
 * resolver callbacks until their SWF symbol mapping is established.
 * With a resolver that knows the game's `$T_n` tiles (an asset release) grounds are drawn with the game's
 * textures (`ground-texture.js`): `textures: false` turns that off, `textureSeed` fixes the random tile choice, and
 * `pregeneratedBitmaps: true` selects what the game does in slow mode or on mobile (docs/rendering.md#grounds; off by
 * default, so static grounds get the `$E_1` overlay). A ground whose assets are missing falls back to the placeholder.
 * Holes and cheese use the client's `$Trou_Souris` / `$Fromage*` clips when the resolver has them (placeholders otherwise).
 * Decorations are drawn from the resolver's `$P_<type>` clips (default) with the client's mirroring; a resolver that has no such
 * clip simply draws none.
 * `settings.F` backgrounds (`$F_n`) are drawn when the resolver knows them; for `F="-2"` (random in the client) the picture is a composite of the client's backgrounds 0, 1, 2, 3 and 7, one vertical strip each
 * (`compositeRandomBackground: false` picks one with `randomBackgroundIndex` from `RANDOM_BACKGROUND_IDS` instead).
 * Decorations with `P` = `0,2` (flip with probability 1/2 in the client) are drawn unflipped; `randomDecorationFlip: true` flips them by a seeded coin.
 * `clientLimits` chooses what the game would cut or switch off (see client-limits.js, docs/xml/limits-and-modes.md#restricted-maps): a preset
 * (`"unrestricted"`, the default, draws everything the XML says; `"restricted"`, an ordinary player map (not official, not `#Module`): width 1600
 * (4800 with `defilante`), height 800, 60 grounds, 50 decoration nodes, 40 shaman objects, and ground `i`, `APS`, `ARPS`, `IP`,
 * tiled `D` and repeat clones off; `"module"`, a `#Module` room: no caps, ARPS off) or an object of custom
 * values (`{ preset: "restricted", maxGrounds: 200 }`). `restricted: true` is an alias of `clientLimits: "restricted"`. The parsed
 * map is never modified. (`limits` is something else: the maximum output size in pixels.)
 * `maxViewport: { width, height }` is a soft limit in map units: a larger viewport (or map, without one) is cut down to it from its
 * top-left corner instead of failing (`renderedViewport` tells whether it was). Whatever lies wholly outside the viewport is left out (cull.js).
 * With `renderHideOffscreenFrame: true`, `Ca` maps (`hideOffscreen`) get the client's frame in the room colour around the 800x600 play area (opt-in: `renderHideOffscreenFrame: true`; off by default); with `renderSoulmateHeart: true` (off by default) `A` maps (`soulmate`) get the `$P5` heart at (12, 30) when the resolver has it.
 * Blur: hole glows use Flash's exact box blurs (three passes of width 5); `flashBlur: false` uses a Gaussian instead. The bundle resolver does the same for the clips' own filters (`loadRelease(dir, { flashBlur })`).
 * `renderAppearingImages: true` draws the `ARPS` images and `renderIpImages: true` the `IP` images (server-triggered pictures of a few event maps; `renderPortalImages` is the old name) as if shown (both off by default: the game shows an `ARPS` image only while the player
 * stands in its rectangle and an `IP` image for 5 s after a server packet); `ARPS` needs `clientLimits.arps`, `IP` an unrestricted map.
 * Nails: with `objectMode: "game"` every nail is drawn (when a nail is made is physics and run time, not the picture); `nailVisibility: "client"` applies the client's rules instead (joins at least one or two bodies, the limit of 11 rotating joints, `mc`, one world-nail picture per body: reference 19.5).
 * Joints with a style (`c`) are drawn as the client draws them (`renderJoints: false` leaves them out).
 * `modules` turns the overlays of Lua modules on or off: `{ parkour: "auto" }` (default; drawn when the parser detected a parkour
 * map: its checkpoints, their size, cheese and stop), `true` to force, `false` to hide; `modules: false` hides all.
 * `parkourNails: false` leaves out the checkpoint nail the parkour overlay draws over each checkpoint mouse (on by default, as in Miceditor).
 * `parkourStyle` sets the tint of `stop` checkpoints and the height and colours of the checkpoint number and size labels (`resolveParkourStyle` in modules/parkour.js).
 * `minimalist: true` reproduces the client's minimalist mode (user option 14): grounds are the client's flat colours per
 * type (`ground-textures.js`, `flat`), the `F` background, the background `D` images (the `#` tiled bitmap stays) and the `$P_` decoration
 * pictures are not drawn.  The client ignores the option for map mode 22 and for
 * `defilante` maps; callers decide that.
 */
export function renderTfmSvg(map, options = {}) {
  if (!map?.settings) throw new TypeError("renderTfmSvg expects a parsed TfmMap");
  const clientLimits = resolveClientLimits(options.clientLimits ?? (options.restricted === true ? "restricted" : "unrestricted"));
  const modules = resolveModuleOptions(options.modules);
  map = applyClientLimits(map, clientLimits);
  const viewport = normalizeViewport(map, options);
  const scale = finiteOr(options.scale, 1);
  if (scale <= 0) throw new RangeError("SVG scale must be positive");
  const rotation = finiteOr(options.rotation, 0);
  const resolver = options.assetResolver ?? null;
  const defaults = options.defaultAssets !== false;
  const outputWidth = viewport.width * scale;
  const outputHeight = viewport.height * scale;
  assertWithinLimits(outputWidth, outputHeight, options.limits);
  const centerX = viewport.x + viewport.width / 2;
  const centerY = viewport.y + viewport.height / 2;
  const visible = createCuller(viewport, { mirrorX: options.mirrorX === true, rotation });

  const transforms = [];
  if (options.mirrorX) transforms.push(`translate(${viewport.mapWidth} 0) scale(-1 1)`);
  if (rotation) transforms.push(`rotate(${rotation} ${centerX} ${centerY})`);
  const transform = transforms.length ? attr("transform", transforms.join(" ")) : "";

  const decorationRandom = seededRandom(finiteOr(options.textureSeed, 1) + 1);
  const textures = options.textures === false || !resolver ? null : createTextureContext(resolver, finiteOr(options.textureSeed, 1));
  const restricted = clientLimits.restricted;
  const joints = options.renderJoints === false ? { back: "", front: "" } : renderJoints(map);
  const grounds = renderGrounds(map, resolver, defaults, options.minimalist === true, textures, options.pregeneratedBitmaps === true, restricted, options.mirrorX === true, visible);
  const cheeseSuffix = typeof options.cheeseSuffix === "string" ? options.cheeseSuffix : "";
  const markers = defaults ? markerParts(map, resolver, { cheeseSuffix, spawnMarkers: options.spawnMarkers, mirrored: options.mirrorX === true, visible }) : { back: [], ground: [], objects: [] };
  const backMarkers = markers.back;
  const backDecorations = decorationParts(map, resolver, options.resolveDecorationAsset, { random: decorationRandom, minimalist: options.minimalist === true, randomFlip: options.randomDecorationFlip === true, visible });
  const back = backDecorations.map((part, i) => part + (backMarkers[i] ?? "")).join("");
  // Bottom to top, in the game's layer order (docs/rendering.md#draw-order).
  const body = [
    textureDefs(textures ?? { defs: new Map() }),
    defaults ? holeGlowDefs(map, options.flashBlur !== false) : "",
    renderMapBackground(map, resolver, options, viewport.mapWidth, viewport.mapHeight, visible),
    renderDImages(map.settings.images?.background, resolver, "background", viewport.mapWidth, viewport.mapHeight, options.minimalist === true, restricted, options.renderTiledBackgrounds === true, options.mirrorX === true, visible),
    back,
    options.renderAppearingImages === true && clientLimits.arps ? renderApsImages(map.settings.images?.appearing, resolver, "arps", visible) : "",
    (options.renderIpImages === true || options.renderPortalImages === true) && !restricted ? renderMapImageRecords(map.settings.images?.ip, resolver, visible) : "",
    joints.back,
    grounds.base,
    markers.ground.join(""),
    renderObjectAssets(map, resolver, options.resolveObjectAsset, { placeholders: options.objectPlaceholders !== false, mode: options.objectMode === "game" ? "game" : "editor", random: decorationRandom, mirrored: options.mirrorX === true, clientNails: options.nailVisibility === "client", visible }),
    markers.objects.join(""),
    joints.front,
    renderDImages(map.settings.images?.foreground, resolver, "foreground", viewport.mapWidth, viewport.mapHeight, false, restricted, options.renderTiledBackgrounds === true, options.mirrorX === true, visible),
    grounds.foreground,
    decorationParts(map, resolver, options.resolveDecorationAsset, { foreground: true, random: decorationRandom, minimalist: options.minimalist === true, randomFlip: options.randomDecorationFlip === true, visible }).join(""),
    restricted ? "" : renderApsImages(map.settings.images?.disappearing, resolver, "aps", visible),
    // Lua module overlays (parkour checkpoints, ...): annotations over the map, not something the game draws.
    renderModules(map, modules, { resolver, mirrored: options.mirrorX === true, map, nails: options.parkourNails !== false, parkourStyle: options.parkourStyle, visible }),
    options.debugMarkers ? renderDebugMarkers(map) : "",
    options.renderSoulmateHeart === true && map.settings.soulmate && defaults ? renderSoulmateClip(resolver, visible) : "",
    options.borders === "map" || options.borders === "all"
      ? `<rect${attr("x", 0)}${attr("y", 0)}${attr("width", viewport.mapWidth)}${attr("height", viewport.mapHeight)}${attr("fill", "none")}${attr("stroke", "#000")}/>`
      : "",
  ].join("");

  const room = options.backgroundColor === undefined ? (defaults ? DEFAULT_ROOM_COLOR : null) : options.backgroundColor;
  const roomRect = typeof room === "string" && room !== "" && room !== "none" && room !== "transparent"
    ? `<rect${attr("x", viewport.x)}${attr("y", viewport.y)}${attr("width", viewport.width)}${attr("height", viewport.height)}${attr("fill", room)}/>`
    : "";
  // A map with `Ca` gets a frame in the room colour around the 800x600 play area, over everything (screen space, not mirrored).
  const roomOff = room === null || room === "none" || room === "transparent" || room === "";
  const frame = options.renderHideOffscreenFrame !== true || !map.settings.hideOffscreen || roomOff
    ? ""
    : `<path${attr("d", "M-2000 -2000h4800v4600h-4800zM0 0v600h800v-600z")}${attr("fill", room)}${attr("fill-rule", "evenodd")}/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg"${attr("width", outputWidth)}${attr("height", outputHeight)}${attr("viewBox", `${viewport.x} ${viewport.y} ${viewport.width} ${viewport.height}`)}>${roomRect}<g${transform}>${body}</g>${frame}</svg>`;
}

/** A map with `A` (soulmate) gets the `$P5` clip, frame 1, at (12, 30) in the top layer. Nothing without the clip. */
function renderSoulmateClip(resolver, visible = ALL) {
  const asset = resolveImage(resolver, "$P5", "sprite", { key: "$P5" });
  if (!asset || !visible(assetBox(asset, 12, 30))) return "";
  return `<g${attr("transform", "translate(12 30)")}>${imageElement(asset, -(asset.origin?.x ?? 0), -(asset.origin?.y ?? 0))}</g>`;
}

function renderMapImageRecords(records, resolver, visible = ALL) {
  return (records ?? []).map((record) => renderMapImage(record, resolver, "standard", visible)).join("");
}
