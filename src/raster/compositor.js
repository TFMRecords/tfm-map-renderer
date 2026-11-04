// The PNG compositor: draws a scene (src/render/scene.js) straight into pixels, in horizontal strips, so memory is one strip
// (plus the picture cache) whatever the size of the output. The game's pictures come from a picture cache (pictures.js) at the
// size they are drawn; everything else is drawn here. docs/rendering.md#png-compositor lists what it draws and how it differs from resvg.
//
// Pixels are premultiplied RGBA floats from 0 to 1 while drawing; each finished strip is handed over as straight-alpha RGBA bytes.

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
 * @param {{width?: number, height?: number}} size output size in pixels (default the scene's); the view box is fitted into it
 *   centred, keeping its aspect ratio (SVG's default `xMidYMid meet`)
 */
export function flattenScene(scene, { width, height } = {}) {
  const { width: W, height: H } = sceneSize(scene, { width, height });
  const [vx, vy, vw, vh] = String(scene.viewBox ?? `0 0 ${W} ${H}`).trim().split(/[\s,]+/).map(Number);
  const s = Math.min(W / vw, H / vh);
  const root = [s, 0, 0, s, (W - vw * s) / 2 - vx * s, (H - vh * s) / 2 - vy * s];
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
          if (filter.effect?.kind !== "colorMatrix") note(`filter ${filter.effect?.kind}`);
          const layer = { kind: "layer", effect: filter.effect, ops: [], box: null };
          walk(node.children, gm, groupClips, groupBox, layer.ops);
          for (const op of layer.ops) layer.box = union(layer.box, op.box);
          if (layer.box) out.push(layer);
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
        out.push({ kind: "image", href: node.href, preserveAspectRatio: node.preserveAspectRatio, blend: node.blend ?? null, x: node.x ?? 0, y: node.y ?? 0, w, h, m, clips, box: opBox });
        return;
      }
      case "rect":
      case "circle":
      case "ellipse": {
        if (node.stroke != null && node.stroke !== "none") note(`${node.type} stroke`);
        if (node.fill === "none") return;
        const color = parseColor(node.fill ?? "#000000");
        if (!color) { note(`fill ${node.fill}`); return; }
        const alpha = Math.min(1, Math.max(0, node.fillOpacity ?? 1));
        let shape;
        if (node.type === "rect") shape = { x: node.x ?? 0, y: node.y ?? 0, w: node.width ?? 0, h: node.height ?? 0 };
        else {
          const rx = node.type === "circle" ? node.r : node.rx, ry = node.type === "circle" ? node.r : node.ry;
          shape = { cx: node.cx ?? 0, cy: node.cy ?? 0, rx: Math.abs(rx ?? 0), ry: Math.abs(ry ?? 0) };
          shape.x = shape.cx - shape.rx; shape.y = shape.cy - shape.ry; shape.w = 2 * shape.rx; shape.h = 2 * shape.ry;
        }
        if (!(shape.w > 0 && shape.h > 0) || !alpha) return;
        const opBox = intersect(box, boxOf(m, shape.x, shape.y, shape.w, shape.h));
        const inv = invert(m);
        if (!opBox || !inv) return;
        out.push({ kind: node.type === "rect" ? "rect" : "ellipse", ...shape, color, alpha, inv, sx: Math.hypot(m[0], m[1]), sy: Math.hypot(m[2], m[3]), clips, box: opBox, hard });
        return;
      }
      default:
        note(node.type);
    }
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
  const picture = pictures.picture(op.href, op.m, { x: op.x, y: op.y, width: op.w, height: op.h }, op.preserveAspectRatio);
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

function drawLayer(op, target, pictures) {
  const area = span(op, target);
  if (!area) return;
  const layer = { data: new Float32Array((area.x1 - area.x0) * (area.y1 - area.y0) * 4), ...area };
  drawOps(op.ops, layer, pictures);
  if (op.effect?.kind === "colorMatrix") colorMatrix(layer.data, op.effect.matrix);
  const data = target.data, stride = target.x1 - target.x0, lw = area.x1 - area.x0;
  for (let y = area.y0; y < area.y1; y++) {
    let i = ((y - target.y0) * stride + (area.x0 - target.x0)) * 4;
    let j = (y - area.y0) * lw * 4;
    for (let x = area.x0; x < area.x1; x++, i += 4, j += 4) {
      const a = layer.data[j + 3];
      if (a > 0) put(data, i, layer.data[j], layer.data[j + 1], layer.data[j + 2], a, null);
    }
  }
}

function drawOps(ops, target, pictures) {
  for (const op of ops) {
    if (op.box.y1 <= target.y0 || op.box.y0 >= target.y1 || op.box.x1 <= target.x0 || op.box.x0 >= target.x1) continue;
    if (op.kind === "image") drawImage(op, target, pictures);
    else if (op.kind === "layer") drawLayer(op, target, pictures);
    else drawShape(op, target);
  }
}

/**
 * Draws a scene strip by strip.
 * @param {object} scene the root node of `renderTfmScene`
 * @param {{pictures: ReturnType<import("./pictures.js").createPictureCache>, width?: number, height?: number, stripBytes?: number,
 *   onStrip: (rgba: Uint8Array, y: number, rows: number) => (void|Promise<void>)}} options `width` / `height` the output size
 *   (default the scene's); strips hold about `stripBytes` (default 16 MB) of working pixels; `onStrip` gets each strip as
 *   straight-alpha RGBA, top to bottom
 * @returns {Promise<{width: number, height: number, unsupported: object}>} `unsupported` counts the scene nodes not drawn
 */
export async function renderSceneStrips(scene, { pictures, width, height, stripBytes = 16 * 1024 * 1024, onStrip }) {
  const flat = flattenScene(scene, { width, height });
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
