// The PNG compositor: draws a scene (src/render/scene.js) straight into pixels, in horizontal strips, so memory is one strip
// (plus the picture cache) whatever the size of the output. The game's pictures come from a picture cache (pictures.js) at the
// size they are drawn; everything else is drawn here. docs/rendering.md#png-compositor lists what it draws and how it differs from resvg.
//
// Pixels are premultiplied RGBA floats from 0 to 1 while drawing; each finished strip is handed over as straight-alpha RGBA bytes.
import { boxBlur, dashCoverage, dashSegments, fillMask, parsePath, strokeMask } from "./shapes.js";

// --- Matrices: [a, b, c, d, e, f] maps (x, y) to (a x + c y + e, b x + d y + f), as in SVG.

function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det || !Number.isFinite(det)) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

const translate = (x, y) => [1, 0, 0, 1, x, y];

/** The matrix of a scene transform list (scene.js `transform`). */
export function transformMatrix(ops) {
  let m = [1, 0, 0, 1, 0, 0];
  for (const [name, ...a] of ops ?? []) {
    let n;
    if (name === "translate") n = translate(a[0], a[1] ?? 0);
    else if (name === "scale") n = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (name === "rotate") {
      const r = (a[0] * Math.PI) / 180;
      n = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
      if (a.length >= 3) n = multiply(multiply(translate(a[1], a[2]), n), translate(-a[1], -a[2]));
    } else if (name === "matrix") n = a;
    else throw new TypeError(`unknown transform "${name}"`);
    m = multiply(m, n);
  }
  return m;
}

const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

// --- Boxes: { x0, y0, x1, y1 } in device pixels.

function boxOf(m, x, y, w, h) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [px, py] of [apply(m, x, y), apply(m, x + w, y), apply(m, x, y + h), apply(m, x + w, y + h)]) {
    x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py);
  }
  return { x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 }; // one pixel of edge smoothing on each side
}

function intersect(a, b) {
  const box = { x0: Math.max(a.x0, b.x0), y0: Math.max(a.y0, b.y0), x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1) };
  return box.x0 < box.x1 && box.y0 < box.y1 ? box : null;
}

const union = (a, b) => (a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : b);
const grow = (a, m) => (m ? { x0: a.x0 - m, y0: a.y0 - m, x1: a.x1 + m, y1: a.y1 + m } : a);

/**
 * A clip of a rectangle in the space of `m`: its four edges as half-planes in device pixels, `a x + b y + c` being the signed
 * distance to the edge (positive inside), plus its box.
 */
function rectClip(m, x, y, w, h) {
  const p = [apply(m, x, y), apply(m, x + w, y), apply(m, x + w, y + h), apply(m, x, y + h)];
  const cx = (p[0][0] + p[2][0]) / 2, cy = (p[0][1] + p[2][1]) / 2;
  const edges = [];
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = p[i];
    const [bx, by] = p[(i + 1) % 4];
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) return { edges: [{ a: 0, b: 0, c: -1 }], box: null }; // a degenerate clip hides everything
    let a = -(by - ay) / len, b = (bx - ax) / len;
    if (a * (cx - ax) + b * (cy - ay) < 0) { a = -a; b = -b; }
    edges.push({ a, b, c: -(a * ax + b * ay) });
  }
  return { edges, box: boxOf(m, x, y, w, h) };
}

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** The box of device points, grown by `grow` pixels. */
function pointsBox(points, grow) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x0: x0 - grow, y0: y0 - grow, x1: x1 + grow, y1: y1 + grow };
}

/** A `strokeDasharray` ("3 2") as lengths, an even number of them; null for none or a pattern of zeros. */
function parseDashes(value) {
  if (value == null || value === "none") return null;
  const lengths = String(value).trim().split(/[\s,]+/).map(Number);
  if (lengths.some((n) => !(n >= 0)) || !lengths.some((n) => n > 0)) return null;
  return lengths.length % 2 ? [...lengths, ...lengths] : lengths;
}

// --- Colours.

const NAMED = { black: "#000000", white: "#ffffff", red: "#ff0000", lime: "#00ff00", blue: "#0000ff" };

/** "#rgb" / "#rrggbb" (and a few names) as [r, g, b] from 0 to 1; null for "none", "transparent" or anything unknown. */
export function parseColor(value) {
  if (typeof value !== "string") return null;
  let hex = NAMED[value.toLowerCase()] ?? value;
  if (/^#[0-9a-f]{3}$/i.test(hex)) hex = `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`;
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return null;
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

// --- Flattening: the scene becomes a list of draw steps with their device matrix, clips and box.

/** The output size in pixels: `width` / `height` when given, else the scene's own, rounded. */
export function sceneSize(scene, { width, height } = {}) {
  if (scene?.type !== "svg") throw new TypeError("expected the root svg node of renderTfmScene");
  const W = Math.round(width ?? scene.width);
  const H = Math.round(height ?? scene.height);
  if (!(W > 0 && H > 0)) throw new RangeError("the output size must be positive");
  return { width: W, height: H };
}

/**
 * @param {object} scene the root `svg` node of `renderTfmScene`
 * @param {{width?: number, height?: number, fit?: "meet"|"fill"}} size output size in pixels (default the scene's); the view
 *   box is fitted into it centred, keeping its aspect ratio (`meet`, SVG's default `xMidYMid meet`), or stretched to it
 *   (`fill`, as `preserveAspectRatio="none"`)
 */
export function flattenScene(scene, { width, height, fit = "meet" } = {}) {
  const { width: W, height: H } = sceneSize(scene, { width, height });
  const [vx, vy, vw, vh] = String(scene.viewBox ?? `0 0 ${W} ${H}`).trim().split(/[\s,]+/).map(Number);
  const s = Math.min(W / vw, H / vh);
  const root = fit === "fill" ? [W / vw, 0, 0, H / vh, (-vx * W) / vw, (-vy * H) / vh] : [s, 0, 0, s, (W - vw * s) / 2 - vx * s, (H - vh * s) / 2 - vy * s];
  const canvas = { x0: 0, y0: 0, x1: W, y1: H };
  const defs = new Map();
  const unsupported = {};
  const note = (what) => { unsupported[what] = (unsupported[what] ?? 0) + 1; };

  // Inside a texture tile (a `use` of a symbol) edges are hard: each pixel belongs to the one tile that holds its centre, so tiles
  // meet without seams (two half-covered edge pixels would let the background through); the ground's own clip smooths its outline.
  let hard = false;
  // `clips`: the clip half-planes in force; `box`: where they leave anything to draw (null: nothing).
  function walk(node, m, clips, box, out) {
    if (node == null || node === false) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, m, clips, box, out);
      return;
    }
    switch (node.type) {
      case "defs":
        for (const child of node.children ?? []) if (child?.id != null) defs.set(child.id, child);
        return;
      case "comment":
        return;
      case "g": {
        const gm = node.transform ? multiply(m, transformMatrix(node.transform)) : m;
        let groupClips = clips, groupBox = box;
        if (node.clipPath != null) {
          const clip = clipOf(defs.get(node.clipPath), gm);
          if (!clip) return;
          groupClips = [...clips, ...clip.edges];
          groupBox = clip.box && intersect(box, clip.box);
          if (!groupBox) return;
        }
        if (node.filter != null) {
          const filter = defs.get(node.filter);
          if (filter?.type !== "filter") { note(`filter ${node.filter}`); return; }
          const effect = filter.effect;
          if (effect?.kind !== "colorMatrix" && effect?.kind !== "glow") { note(`filter ${effect?.kind}`); walk(node.children, gm, groupClips, groupBox, out); return; }
          const layer = { kind: "layer", effect, ops: [], box: null, margin: 0 };
          if (effect.kind === "glow") {
            // Flash's glow at the group's scale: box blurs of blurX x blurY stage pixels (`flash: false`: three passes of the same spread as its Gaussian).
            const scale = Math.sqrt(Math.abs(gm[0] * gm[3] - gm[1] * gm[2]));
            const flash = effect.flash !== false;
            const widthOf = (blur) => Math.max(1, Math.round(flash ? blur * scale : Math.sqrt(((blur / 2) * scale) ** 2 * 4 + 1)));
            layer.glow = { bx: widthOf(effect.blurX), by: widthOf(effect.blurY), passes: flash ? effect.passes ?? 1 : 3, strength: effect.strength ?? 1, color: parseColor(effect.color) ?? [0, 0, 0] };
            layer.margin = Math.ceil((layer.glow.passes * Math.max(layer.glow.bx, layer.glow.by)) / 2) + 1;
          }
          // The children are drawn `margin` pixels beyond what shows, which the glow reaches into.
          walk(node.children, gm, groupClips, grow(groupBox, layer.margin), layer.ops);
          for (const op of layer.ops) layer.box = union(layer.box, op.box);
          layer.box = layer.box && intersect(grow(layer.box, layer.margin), groupBox);
          if (!layer.box) return;
          out.push(layer);
          return;
        }
        walk(node.children, gm, groupClips, groupBox, out);
        return;
      }
      case "use": {
        const symbol = defs.get(String(node.href ?? "").replace(/^#/, ""));
        if (symbol?.type !== "symbol") { note("use"); return; }
        const [sx, sy, sw, sh] = String(symbol.viewBox ?? `0 0 ${node.width} ${node.height}`).trim().split(/[\s,]+/).map(Number);
        const um = multiply(m, multiply(multiply(translate(node.x ?? 0, node.y ?? 0), [(node.width ?? sw) / sw, 0, 0, (node.height ?? sh) / sh, 0, 0]), translate(-sx, -sy)));
        let useClips = clips, useBox = box;
        if (symbol.overflow === "hidden") {
          const clip = rectClip(um, sx, sy, sw, sh);
          useClips = [...clips, ...clip.edges.map((e) => ({ ...e, hard: true }))];
          useBox = clip.box && intersect(box, clip.box);
          if (!useBox) return;
        }
        const outer = hard;
        hard = true;
        walk(symbol.children, um, useClips, useBox, out);
        hard = outer;
        return;
      }
      case "image": {
        const w = Number(node.width), h = Number(node.height);
        if (!(w > 0 && h > 0) || !node.href) { note("image without a size"); return; }
        const opBox = intersect(box, boxOf(m, node.x ?? 0, node.y ?? 0, w, h));
        if (!opBox || !invert(m)) return;
        // `need`: where the picture can show, the same in every strip, so the picture cache crops it once for all strips.
        out.push({ kind: "image", href: node.href, preserveAspectRatio: node.preserveAspectRatio, blend: node.blend ?? null, x: node.x ?? 0, y: node.y ?? 0, w, h, m, clips, box: opBox, need: opBox });
        return;
      }
      case "text":
        return; // the server's resvg loads no fonts and draws no text either (the placeholders' type numbers)
      case "path": {
        const subpaths = parsePath(node.d);
        if (!subpaths) { note("path curve"); return; }
        const device = subpaths.map(({ points, closed }) => ({ closed, points: points.map(([x, y]) => apply(m, x, y)) }));
        const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
        if (node.fill !== "none") {
          const color = parseColor(node.fill ?? "#000000");
          const alpha = clamp01(node.fillOpacity ?? 1);
          if (!color) note(`fill ${node.fill}`);
          else if (alpha > 0) {
            const opBox = intersect(box, pointsBox(device.flatMap((d) => d.points), 1));
            if (opBox) out.push({ kind: "fill", subpaths: device, rule: node.fillRule === "evenodd" ? "evenodd" : "nonzero", color, alpha, clips, box: opBox });
          }
        }
        if (node.stroke != null && node.stroke !== "none") {
          const dashes = parseDashes(node.strokeDasharray)?.map((n) => n * scale) ?? null;
          const segments = device.flatMap(({ points, closed }) => dashSegments(points, closed, dashes));
          pushStroke(out, node, segments, ((node.strokeWidth ?? 1) / 2) * scale, node.strokeLinecap ?? "butt", clips, box);
        }
        return;
      }
      case "rect":
      case "circle":
      case "ellipse": {
        let shape;
        if (node.type === "rect") shape = { x: node.x ?? 0, y: node.y ?? 0, w: node.width ?? 0, h: node.height ?? 0 };
        else {
          const rx = node.type === "circle" ? node.r : node.rx, ry = node.type === "circle" ? node.r : node.ry;
          shape = { cx: node.cx ?? 0, cy: node.cy ?? 0, rx: Math.abs(rx ?? 0), ry: Math.abs(ry ?? 0) };
          shape.x = shape.cx - shape.rx; shape.y = shape.cy - shape.ry; shape.w = 2 * shape.rx; shape.h = 2 * shape.ry;
        }
        if (!(shape.w > 0 && shape.h > 0)) return;
        const inv = invert(m);
        if (!inv) return;
        const sx = Math.hypot(m[0], m[1]), sy = Math.hypot(m[2], m[3]);
        const scale = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
        if (node.fill !== "none") {
          const color = parseColor(node.fill ?? "#000000");
          const alpha = clamp01(node.fillOpacity ?? 1);
          if (!color) note(`fill ${node.fill}`);
          else if (alpha > 0) {
            const opBox = intersect(box, boxOf(m, shape.x, shape.y, shape.w, shape.h));
            if (opBox) out.push({ kind: node.type === "rect" ? "rect" : "ellipse", ...shape, color, alpha, inv, sx, sy, clips, box: opBox, hard });
          }
        }
        if (node.stroke != null && node.stroke !== "none") {
          const hw = (node.strokeWidth ?? 1) / 2;
          const dashes = parseDashes(node.strokeDasharray);
          if (node.type === "rect" && dashes) {
            // A dashed outline: the rectangle as a closed line, cut into dashes.
            const corners = [[shape.x, shape.y], [shape.x + shape.w, shape.y], [shape.x + shape.w, shape.y + shape.h], [shape.x, shape.y + shape.h]].map(([x, y]) => apply(m, x, y));
            pushStroke(out, node, dashSegments(corners, true, dashes.map((n) => n * scale)), hw * scale, node.strokeLinecap ?? "butt", clips, box);
          } else {
            const color = parseColor(node.stroke);
            const alpha = clamp01(node.strokeOpacity ?? 1);
            if (!color) note(`stroke ${node.stroke}`);
            else if (alpha > 0) {
              const opBox = intersect(box, boxOf(m, shape.x - hw, shape.y - hw, shape.w + 2 * hw, shape.h + 2 * hw));
              if (opBox) out.push({ kind: node.type === "rect" ? "rectStroke" : "ellipseStroke", ...shape, hw, dashes, color, alpha, inv, sx, sy, scale, clips, box: opBox });
            }
          }
        }
        return;
      }
      default:
        note(node.type);
    }
  }

  function pushStroke(out, node, segments, hw, cap, clips, box) {
    const color = parseColor(node.stroke);
    const alpha = clamp01(node.strokeOpacity ?? 1);
    if (!color) { note(`stroke ${node.stroke}`); return; }
    if (!(alpha > 0) || !(hw > 0) || !segments.length) return;
    const opBox = intersect(box, pointsBox(segments.flatMap(([x0, y0, x1, y1]) => [[x0, y0], [x1, y1]]), 2 * hw + 1));
    if (opBox) out.push({ kind: "stroke", segments, hw, cap: cap === "round" || cap === "square" ? cap : "butt", color, alpha, clips, box: opBox });
  }

  function clipOf(clipPath, m) {
    const shapes = (clipPath?.children ?? []).filter(Boolean);
    if (clipPath?.type !== "clipPath" || shapes.length !== 1 || shapes[0].type !== "rect" || shapes[0].transform) {
      note("clip shape");
      return null;
    }
    const r = shapes[0];
    return rectClip(m, r.x ?? 0, r.y ?? 0, r.width ?? 0, r.height ?? 0);
  }

  const ops = [];
  walk(scene.children, root, [], canvas, ops);
  return { width: W, height: H, ops, unsupported };
}

// --- Drawing into a target: { data: Float32Array premultiplied RGBA, x0, y0, x1, y1 } (device pixels; data holds the rows
// y0..y1 of the columns x0..x1).

function clipCoverage(clips, X, Y) {
  let c = 1;
  for (let i = 0; i < clips.length; i++) {
    const e = clips[i];
    const d = e.a * X + e.b * Y + e.c + 0.5;
    if (e.hard) { if (d <= 0.5) return 0; continue; }
    if (d <= 0) return 0;
    if (d < 1) c *= d;
  }
  return c;
}

/**
 * Where the clips leave every pixel whole, when each clip edge follows a pixel axis: pixels in [x0, x1) x [y0, y1) need no
 * coverage test, and nothing outside [ox0, ox1) x [oy0, oy1) is drawn. null when an edge is slanted.
 */
function axisClip(clips) {
  let left = -Infinity, right = Infinity, top = -Infinity, bottom = Infinity;
  for (const e of clips) {
    if (Math.abs(e.b) < 1e-12 && e.a !== 0) {
      const x = -e.c / e.a;
      if (e.a > 0) left = Math.max(left, x); else right = Math.min(right, x);
    } else if (Math.abs(e.a) < 1e-12 && e.b !== 0) {
      const y = -e.c / e.b;
      if (e.b > 0) top = Math.max(top, y); else bottom = Math.min(bottom, y);
    } else return null;
  }
  return {
    x0: Math.ceil(left), x1: Math.floor(right), y0: Math.ceil(top), y1: Math.floor(bottom),
    ox0: Math.floor(left), ox1: Math.ceil(right), oy0: Math.floor(top), oy1: Math.ceil(bottom),
  };
}

/** Composites one premultiplied colour (r, g, b, a) at `i` of `data`, with `blend` (null or "overlay"). */
function put(data, i, r, g, b, a, blend) {
  const k = 1 - a;
  if (blend === "overlay") {
    const da = data[i + 3];
    if (da > 0 && a > 0) {
      for (let ch = 0; ch < 3; ch++) {
        const s = ch === 0 ? r : ch === 1 ? g : b;
        const d = data[i + ch];
        const cs = s / a, cb = d / da;
        const mixed = cb <= 0.5 ? 2 * cs * cb : 1 - 2 * (1 - cs) * (1 - cb);
        data[i + ch] = s * (1 - da) + d * k + a * da * mixed;
      }
      data[i + 3] = a + da * k;
      return;
    }
  }
  data[i] = r + data[i] * k;
  data[i + 1] = g + data[i + 1] * k;
  data[i + 2] = b + data[i + 2] * k;
  data[i + 3] = a + data[i + 3] * k;
}

function span(op, target) {
  const x0 = Math.max(target.x0, Math.floor(op.box.x0)), x1 = Math.min(target.x1, Math.ceil(op.box.x1));
  const y0 = Math.max(target.y0, Math.floor(op.box.y0)), y1 = Math.min(target.y1, Math.ceil(op.box.y1));
  return x0 < x1 && y0 < y1 ? { x0, x1, y0, y1 } : null;
}

function drawImage(op, target, pictures) {
  const area = span(op, target);
  if (!area) return;
  // The picture as it lands on the output (pictures.js): its pixels line up with the device pixels, so they are copied.
  const picture = pictures.picture(op.href, op.m, { x: op.x, y: op.y, width: op.w, height: op.h }, op.preserveAspectRatio, op.need);
  if (!picture) return;
  const { data: t, x0, y0, scale, width: pw, height: ph } = picture;
  const { clips, blend } = op;
  // Axis-aligned clips (the usual case) become a rectangle: only its border pixels are tested.
  const box = clips.length ? axisClip(clips) : null;
  const ax0 = Math.max(area.x0, x0, box ? box.ox0 : -Infinity), ax1 = Math.min(area.x1, x0 + Math.ceil(pw / scale), box ? box.ox1 : Infinity);
  const ay0 = Math.max(area.y0, y0, box ? box.oy0 : -Infinity), ay1 = Math.min(area.y1, y0 + Math.ceil(ph / scale), box ? box.oy1 : Infinity);
  if (ax0 >= ax1 || ay0 >= ay1) return;
  const tested = clips.length > 0;
  const data = target.data, stride = target.x1 - target.x0;
  if (scale === 1) {
    for (let py = ay0; py < ay1; py++) {
      let i = ((py - target.y0) * stride + (ax0 - target.x0)) * 4;
      let p = ((py - y0) * pw + (ax0 - x0)) * 4;
      const rowWhole = !tested || (box !== null && py >= box.y0 && py < box.y1);
      for (let px = ax0; px < ax1; px++, i += 4, p += 4) {
        const a = t[p + 3];
        if (!a) continue;
        let cover = 1;
        if (tested && !(rowWhole && box !== null && px >= box.x0 && px < box.x1)) { cover = clipCoverage(clips, px + 0.5, py + 0.5); if (cover <= 0) continue; }
        if (a === 255 && cover === 1 && blend === null) {
          // An opaque pixel replaces what is under it.
          data[i] = t[p] / 255; data[i + 1] = t[p + 1] / 255; data[i + 2] = t[p + 2] / 255; data[i + 3] = 1;
          continue;
        }
        cover /= 255;
        put(data, i, t[p] * cover, t[p + 1] * cover, t[p + 2] * cover, a * cover, blend);
      }
    }
    return;
  }
  // A raster smaller than the output (a picture above the cache's pixel budget): stretched with bilinear sampling.
  for (let py = ay0; py < ay1; py++) {
    let ry = (py + 0.5 - y0) * scale - 0.5;
    if (ry < 0) ry = 0; else if (ry > ph - 1) ry = ph - 1;
    const iy = ry | 0, fy = ry - iy, iy1 = iy + 1 < ph ? iy + 1 : iy;
    let i = ((py - target.y0) * stride + (ax0 - target.x0)) * 4;
    const rowWhole = !tested || (box !== null && py >= box.y0 && py < box.y1);
    for (let px = ax0; px < ax1; px++, i += 4) {
      let cover = 1 / 255;
      if (tested && !(rowWhole && box !== null && px >= box.x0 && px < box.x1)) { const c = clipCoverage(clips, px + 0.5, py + 0.5); if (c <= 0) continue; cover *= c; }
      let rx = (px + 0.5 - x0) * scale - 0.5;
      if (rx < 0) rx = 0; else if (rx > pw - 1) rx = pw - 1;
      const ix = rx | 0, fx = rx - ix, ix1 = ix + 1 < pw ? ix + 1 : ix;
      const p00 = (iy * pw + ix) * 4, p10 = (iy * pw + ix1) * 4, p01 = (iy1 * pw + ix) * 4, p11 = (iy1 * pw + ix1) * 4;
      const w00 = (1 - fx) * (1 - fy) * cover, w10 = fx * (1 - fy) * cover, w01 = (1 - fx) * fy * cover, w11 = fx * fy * cover;
      const a = t[p00 + 3] * w00 + t[p10 + 3] * w10 + t[p01 + 3] * w01 + t[p11 + 3] * w11;
      if (a <= 0) continue;
      put(data, i, t[p00] * w00 + t[p10] * w10 + t[p01] * w01 + t[p11] * w11, t[p00 + 1] * w00 + t[p10 + 1] * w10 + t[p01 + 1] * w01 + t[p11 + 1] * w11,
        t[p00 + 2] * w00 + t[p10 + 2] * w10 + t[p01 + 2] * w01 + t[p11 + 2] * w11, a, blend);
    }
  }
}

/**
 * A rectangle whose sides follow the pixel axes, with no clip (the room colour, placeholders): edge pixels are smoothed one by
 * one, and the inside of an opaque one is one row copied down.
 */
function drawAxisRect(op, target, area) {
  const { inv, color, alpha } = op;
  // Device edges of the rectangle, from the inverse matrix (axis-aligned: inv[1] = inv[2] = 0).
  const ex0 = (op.x - inv[4]) / inv[0], ex1 = (op.x + op.w - inv[4]) / inv[0];
  const ey0 = (op.y - inv[5]) / inv[3], ey1 = (op.y + op.h - inv[5]) / inv[3];
  const left = Math.min(ex0, ex1), right = Math.max(ex0, ex1), top = Math.min(ey0, ey1), bottom = Math.max(ey0, ey1);
  const coverX = (px) => Math.max(0, Math.min(px + 1, right) - Math.max(px, left));
  const coverY = (py) => Math.max(0, Math.min(py + 1, bottom) - Math.max(py, top));
  const data = target.data, stride = target.x1 - target.x0;
  const [r, g, b] = color;
  // Columns fully inside; the first row fully inside is copied to the next ones when the colour is opaque.
  const fx0 = Math.max(area.x0, Math.ceil(left)), fx1 = Math.min(area.x1, Math.floor(right));
  let solidRow = -1;
  for (let py = area.y0; py < area.y1; py++) {
    const cy = coverY(py);
    if (cy <= 0) continue;
    const rowStart = (py - target.y0) * stride - target.x0;
    if (cy >= 1 && alpha >= 1 && solidRow >= 0 && fx1 > fx0) {
      data.copyWithin((rowStart + fx0) * 4, (solidRow + fx0) * 4, (solidRow + fx1) * 4);
      for (const px of [area.x0, fx1]) for (let x = px; x < (px === area.x0 ? fx0 : area.x1); x++) {
        const a = alpha * cy * coverX(x);
        if (a > 0) put(data, (rowStart + x) * 4, r * a, g * a, b * a, a, null);
      }
      continue;
    }
    for (let px = area.x0; px < area.x1; px++) {
      const a = alpha * cy * coverX(px);
      if (a > 0) put(data, (rowStart + px) * 4, r * a, g * a, b * a, a, null);
    }
    if (cy >= 1 && alpha >= 1) solidRow = rowStart;
  }
}

function drawShape(op, target) {
  const area = span(op, target);
  if (!area) return;
  const { inv, sx, sy, clips, color, alpha } = op;
  if (op.kind === "rect" && !clips.length && inv[1] === 0 && inv[2] === 0) {
    drawAxisRect(op, target, area);
    return;
  }
  const data = target.data, stride = target.x1 - target.x0;
  const ellipse = op.kind === "ellipse";
  const scale = Math.min(op.rx * sx, op.ry * sy);
  // Axis-aligned clips: only the border pixels of their rectangle are tested.
  const box = clips.length ? axisClip(clips) : null;
  if (box) {
    area.x0 = Math.max(area.x0, box.ox0); area.x1 = Math.min(area.x1, box.ox1);
    area.y0 = Math.max(area.y0, box.oy0); area.y1 = Math.min(area.y1, box.oy1);
  }
  for (let py = area.y0; py < area.y1; py++) {
    const Y = py + 0.5;
    const rowWhole = box !== null && py >= box.y0 && py < box.y1;
    let X = area.x0 + 0.5;
    let u = inv[0] * X + inv[2] * Y + inv[4];
    let v = inv[1] * X + inv[3] * Y + inv[5];
    let i = ((py - target.y0) * stride + (area.x0 - target.x0)) * 4;
    for (let px = area.x0; px < area.x1; px++, X++, u += inv[0], v += inv[1], i += 4) {
      let cover;
      if (ellipse) {
        const k = Math.hypot((u - op.cx) / op.rx, (v - op.cy) / op.ry);
        cover = (1 - k) * scale + 0.5;
        if (cover <= 0) continue;
        if (cover > 1) cover = 1;
      } else if (op.hard) {
        if (u < op.x || u >= op.x + op.w || v < op.y || v >= op.y + op.h) continue;
        cover = 1;
      } else {
        const cu = Math.min((u - op.x) * sx + 0.5, (op.x + op.w - u) * sx + 0.5);
        if (cu <= 0) continue;
        const cv = Math.min((v - op.y) * sy + 0.5, (op.y + op.h - v) * sy + 0.5);
        if (cv <= 0) continue;
        cover = (cu < 1 ? cu : 1) * (cv < 1 ? cv : 1);
      }
      if (clips.length && !(rowWhole && px >= box.x0 && px < box.x1)) { cover *= clipCoverage(clips, X, Y); if (cover <= 0) continue; }
      const a = alpha * cover;
      if (a >= 1) { data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2]; data[i + 3] = 1; continue; }
      put(data, i, color[0] * a, color[1] * a, color[2] * a, a, null);
    }
  }
}

/** A filter's colour matrix on premultiplied pixels (applied to the straight colours, as SVG does). */
function colorMatrix(data, m) {
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a <= 0) continue;
    const r = data[i] / a, g = data[i + 1] / a, b = data[i + 2] / a;
    const clamp = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
    const na = clamp(m[15] * r + m[16] * g + m[17] * b + m[18] * a + m[19]);
    data[i] = clamp(m[0] * r + m[1] * g + m[2] * b + m[3] * a + m[4]) * na;
    data[i + 1] = clamp(m[5] * r + m[6] * g + m[7] * b + m[8] * a + m[9]) * na;
    data[i + 2] = clamp(m[10] * r + m[11] * g + m[12] * b + m[13] * a + m[14]) * na;
    data[i + 3] = na;
  }
}

/**
 * Flash's GlowFilter on premultiplied pixels (w x h): the alpha blurred `passes` times, times `strength`, in `color`, under the
 * picture (as the SVG filter of src/render/scene.js: feMerge of the glow and SourceGraphic).
 */
function glow(data, w, h, { bx, by, passes, strength, color }) {
  const alpha = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3];
  for (let pass = 0; pass < passes; pass++) {
    boxBlur(alpha, w, h, bx, true, pass % 2 === 1);
    boxBlur(alpha, w, h, by, false, pass % 2 === 1);
  }
  for (let i = 0; i < w * h; i++) {
    let g = alpha[i] * strength;
    if (g <= 0) continue;
    if (g > 1) g = 1;
    const k = g * (1 - data[i * 4 + 3]);
    data[i * 4] += color[0] * k; data[i * 4 + 1] += color[1] * k; data[i * 4 + 2] += color[2] * k; data[i * 4 + 3] += k;
  }
}

function drawLayer(op, target, pictures) {
  // A glow reaches `margin` pixels: the layer takes in that much more than the target, so strips join without a seam.
  const m = op.margin ?? 0;
  const area = span(op, m ? { x0: target.x0 - m, y0: target.y0 - m, x1: target.x1 + m, y1: target.y1 + m } : target);
  if (!area) return;
  const layer = { data: new Float32Array((area.x1 - area.x0) * (area.y1 - area.y0) * 4), ...area };
  drawOps(op.ops, layer, pictures);
  if (op.effect?.kind === "colorMatrix") colorMatrix(layer.data, op.effect.matrix);
  if (op.glow) glow(layer.data, area.x1 - area.x0, area.y1 - area.y0, op.glow);
  const data = target.data, stride = target.x1 - target.x0, lw = area.x1 - area.x0;
  const cx0 = Math.max(area.x0, target.x0), cx1 = Math.min(area.x1, target.x1);
  for (let y = Math.max(area.y0, target.y0); y < Math.min(area.y1, target.y1); y++) {
    let i = ((y - target.y0) * stride + (cx0 - target.x0)) * 4;
    let j = ((y - area.y0) * lw + (cx0 - area.x0)) * 4;
    for (let x = cx0; x < cx1; x++, i += 4, j += 4) {
      const a = layer.data[j + 3];
      if (a > 0) put(data, i, layer.data[j], layer.data[j + 1], layer.data[j + 2], a, null);
    }
  }
}

/** Coverage of a rectangle's outline (miter corners) at local (u, v): the box grown by half the width less the box shrunk by it. */
function rectStrokeCoverage(op, u, v) {
  const box = (x, y, w, h) => {
    const cu = Math.min((u - x) * op.sx + 0.5, (x + w - u) * op.sx + 0.5);
    if (cu <= 0) return 0;
    const cv = Math.min((v - y) * op.sy + 0.5, (y + h - v) * op.sy + 0.5);
    if (cv <= 0) return 0;
    return (cu < 1 ? cu : 1) * (cv < 1 ? cv : 1);
  };
  const { x, y, w, h, hw } = op;
  const outer = box(x - hw, y - hw, w + 2 * hw, h + 2 * hw);
  return outer && (w > 2 * hw && h > 2 * hw ? outer - box(x + hw, y + hw, w - 2 * hw, h - 2 * hw) : outer);
}

/** Coverage of an ellipse's outline at local (u, v), dashed from its rightmost point clockwise (as SVG). */
function ellipseStrokeCoverage(op, u, v) {
  const du = u - op.cx, dv = v - op.cy;
  let d;
  if (op.rx === op.ry) d = Math.abs(Math.hypot(du, dv) - op.rx);
  else {
    // Distance to the ellipse, to first order: |k - 1| / |grad k|.
    const k = Math.hypot(du / op.rx, dv / op.ry);
    const g = k ? Math.hypot(du / (op.rx * op.rx), dv / (op.ry * op.ry)) / k : 0;
    d = g ? Math.abs(k - 1) / g : Math.min(op.rx, op.ry);
  }
  let c = (op.hw - d) * op.scale + 0.5;
  if (c <= 0) return 0;
  const thin = 2 * op.hw * op.scale;
  if (c > 1) c = 1;
  if (thin < 1 && c > thin) c = thin;
  if (op.dashes) {
    let angle = Math.atan2(dv / op.ry, du / op.rx);
    if (angle < 0) angle += 2 * Math.PI;
    c *= dashCoverage(angle * ((op.rx + op.ry) / 2), op.dashes, op.scale);
  }
  return c;
}

/** Draws a coverage mask built by `build(mask, area)` in the op's colour, through its clips. */
function drawMask(op, target, build) {
  const area = span(op, target);
  if (!area) return;
  const w = area.x1 - area.x0;
  const mask = new Float32Array(w * (area.y1 - area.y0));
  build(mask, area);
  const { clips, color, alpha } = op;
  const box = clips.length ? axisClip(clips) : null;
  const data = target.data, stride = target.x1 - target.x0;
  for (let py = area.y0; py < area.y1; py++) {
    const rowWhole = box !== null && py >= box.y0 && py < box.y1;
    let i = ((py - target.y0) * stride + (area.x0 - target.x0)) * 4;
    let j = (py - area.y0) * w;
    for (let px = area.x0; px < area.x1; px++, i += 4, j++) {
      let c = mask[j];
      if (c <= 0) continue;
      if (c > 1) c = 1;
      if (clips.length && !(rowWhole && px >= box.x0 && px < box.x1)) { c *= clipCoverage(clips, px + 0.5, py + 0.5); if (c <= 0) continue; }
      const a = c * alpha;
      put(data, i, color[0] * a, color[1] * a, color[2] * a, a, null);
    }
  }
}

/** Fills a mask from a coverage function of local coordinates (the inverse matrix of the op). */
function localMask(op, coverage) {
  return (mask, area) => {
    const { inv } = op;
    const w = area.x1 - area.x0;
    for (let py = area.y0; py < area.y1; py++) {
      const Y = py + 0.5;
      let X = area.x0 + 0.5;
      let u = inv[0] * X + inv[2] * Y + inv[4];
      let v = inv[1] * X + inv[3] * Y + inv[5];
      for (let px = area.x0, j = (py - area.y0) * w; px < area.x1; px++, X++, u += inv[0], v += inv[1], j++) mask[j] = coverage(op, u, v);
    }
  };
}

function drawOps(ops, target, pictures) {
  for (const op of ops) {
    if (op.box.y1 <= target.y0 || op.box.y0 >= target.y1 || op.box.x1 <= target.x0 || op.box.x0 >= target.x1) continue;
    switch (op.kind) {
      case "image": drawImage(op, target, pictures); break;
      case "layer": drawLayer(op, target, pictures); break;
      case "stroke": drawMask(op, target, (mask, area) => strokeMask(mask, area, op.segments, op.hw, op.cap)); break;
      case "fill": drawMask(op, target, (mask, area) => fillMask(mask, area, op.subpaths, op.rule)); break;
      case "rectStroke": drawMask(op, target, localMask(op, rectStrokeCoverage)); break;
      case "ellipseStroke": drawMask(op, target, localMask(op, ellipseStrokeCoverage)); break;
      default: drawShape(op, target);
    }
  }
}

/**
 * Draws a scene strip by strip.
 * @param {object} scene the root node of `renderTfmScene`
 * @param {{pictures: ReturnType<import("./pictures.js").createPictureCache>, width?: number, height?: number, fit?: string,
 *   stripBytes?: number, onStrip: (rgba: Uint8Array, y: number, rows: number) => (void|Promise<void>)}} options `width` /
 *   `height` the output size (default the scene's) and `fit` as for `flattenScene`; strips hold about `stripBytes` (default 16 MB) of working pixels; `onStrip` gets each strip as
 *   straight-alpha RGBA, top to bottom
 * @returns {Promise<{width: number, height: number, unsupported: object}>} `unsupported` counts the scene nodes not drawn
 */
export async function renderSceneStrips(scene, { pictures, width, height, fit, stripBytes = 16 * 1024 * 1024, onStrip }) {
  const flat = flattenScene(scene, { width, height, fit });
  const W = flat.width, H = flat.height;
  const rows = Math.max(1, Math.min(H, Math.floor(stripBytes / (W * 16))));
  const work = new Float32Array(W * rows * 4);
  const out = new Uint8ClampedArray(W * rows * 4);
  for (let y = 0; y < H; y += rows) {
    const n = Math.min(rows, H - y);
    const target = { data: n === rows ? work : work.subarray(0, W * n * 4), x0: 0, y0: y, x1: W, y1: y + n };
    target.data.fill(0);
    drawOps(flat.ops, target, pictures);
    // Straight alpha, rounded by the clamped array itself.
    const d = target.data;
    for (let i = 0; i < W * n * 4; i += 4) {
      const a = d[i + 3];
      if (a >= 1) { out[i] = d[i] * 255; out[i + 1] = d[i + 1] * 255; out[i + 2] = d[i + 2] * 255; out[i + 3] = 255; continue; }
      if (a <= 0) { out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0; continue; }
      const k = 255 / a;
      out[i] = d[i] * k; out[i + 1] = d[i + 1] * k; out[i + 2] = d[i + 2] * k; out[i + 3] = a * 255;
    }
    await onStrip(out.subarray(0, W * n * 4), y, n);
  }
  return { width: W, height: H, unsupported: flat.unsupported };
}
