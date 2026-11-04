// Geometry of scene nodes (src/render/scene.js): the matrices of their transform lists, and the box of everything they draw.
// The renderer measures a map's content with it (`fitContent`), and the PNG compositor (src/raster) draws with the same matrices.

// Matrices: [a, b, c, d, e, f] maps (x, y) to (a x + c y + e, b x + d y + f), as in SVG.

export function multiplyMatrix(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
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
      if (a.length >= 3) n = multiplyMatrix(multiplyMatrix(translate(a[1], a[2]), n), translate(-a[1], -a[2]));
    } else if (name === "matrix") n = a;
    else throw new TypeError(`unknown transform "${name}"`);
    m = multiplyMatrix(m, n);
  }
  return m;
}

const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** The points that bound a path's outline: its vertices and the control points of its curves (a box that may be a little large). */
function pathPoints(d) {
  const tokens = String(d ?? "").match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const points = [];
  let i = 0, cmd = "", x = 0, y = 0, sx = 0, sy = 0;
  const next = () => Number(tokens[i++]);
  const more = () => i < tokens.length && !/[a-zA-Z]/.test(tokens[i]);
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    else if (!cmd) { i++; continue; }
    const rel = cmd === cmd.toLowerCase();
    const at = (px, py) => (rel ? [x + px, y + py] : [px, py]);
    switch (cmd.toUpperCase()) {
      case "Z": x = sx; y = sy; continue;
      case "M": case "L": case "T": {
        if (!more()) { i++; continue; }
        [x, y] = at(next(), next());
        if (cmd.toUpperCase() === "M") { sx = x; sy = y; cmd = rel ? "l" : "L"; }
        points.push([x, y]);
        break;
      }
      case "H": x = rel ? x + next() : next(); points.push([x, y]); break;
      case "V": y = rel ? y + next() : next(); points.push([x, y]); break;
      case "C": case "S": case "Q": {
        const pairs = cmd.toUpperCase() === "C" ? 3 : 2;
        const base = [x, y];
        for (let k = 0; k < pairs; k++) {
          const px = next(), py = next();
          const p = rel ? [base[0] + px, base[1] + py] : [px, py];
          points.push(p);
          if (k === pairs - 1) [x, y] = p;
        }
        break;
      }
      case "A": {
        const rx = Math.abs(next()), ry = Math.abs(next());
        next(); next(); next();
        const [ex, ey] = at(next(), next());
        // The arc stays within its radii of both ends.
        const r = Math.max(rx, ry);
        for (const [px, py] of [[x, y], [ex, ey]]) points.push([px - r, py - r], [px + r, py + r]);
        x = ex; y = ey;
        break;
      }
      default: i++;
    }
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
  }
  return points;
}

/**
 * The box of everything `node` draws, after `matrix`, as { x0, y0, x1, y1 }; null when it draws nothing. Boxes of pictures are
 * their whole `width` x `height` (transparent edges included), strokes add half their width, a clip path limits what it clips,
 * and `text` counts as its anchor point. Definitions (`defs`) draw nothing themselves.
 */
export function sceneBounds(node, matrix = [1, 0, 0, 1, 0, 0]) {
  const defs = new Map();
  let box = null;
  const add = (b) => {
    if (!b) return;
    box = box ? { x0: Math.min(box.x0, b.x0), y0: Math.min(box.y0, b.y0), x1: Math.max(box.x1, b.x1), y1: Math.max(box.y1, b.y1) } : b;
  };
  const pointsBox = (m, pts, grow = 0) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [px, py] of pts) {
      for (const [gx, gy] of grow ? [[-grow, -grow], [grow, -grow], [-grow, grow], [grow, grow]] : [[0, 0]]) {
        const X = m[0] * (px + gx) + m[2] * (py + gy) + m[4], Y = m[1] * (px + gx) + m[3] * (py + gy) + m[5];
        if (X < x0) x0 = X; if (X > x1) x1 = X; if (Y < y0) y0 = Y; if (Y > y1) y1 = Y;
      }
    }
    return x0 <= x1 && Number.isFinite(x0 + x1 + y0 + y1) ? { x0, y0, x1, y1 } : null;
  };
  const rectBox = (m, x, y, w, h, grow = 0) => pointsBox(m, [[x, y], [x + w, y], [x, y + h], [x + w, y + h]], grow);
  const stroke = (n) => (n.stroke && n.stroke !== "none" ? num(n.strokeWidth, 1) / 2 : 0);
  const filled = (n) => n.fill !== "none" || stroke(n) > 0;

  function measure(n, m) {
    if (n == null || n === false) return null;
    if (Array.isArray(n)) {
      let b = null;
      for (const child of n) {
        const c = measure(child, m);
        if (c) b = b ? { x0: Math.min(b.x0, c.x0), y0: Math.min(b.y0, c.y0), x1: Math.max(b.x1, c.x1), y1: Math.max(b.y1, c.y1) } : c;
      }
      return b;
    }
    switch (n.type) {
      case "defs":
        for (const child of n.children ?? []) if (child?.id != null) defs.set(child.id, child);
        return null;
      case "svg": case "g": {
        const gm = n.transform ? multiplyMatrix(m, transformMatrix(n.transform)) : m;
        let b = measure(n.children, gm);
        const clip = n.clipPath != null ? measure(defs.get(n.clipPath)?.children, gm) : null;
        if (b && clip) b = { x0: Math.max(b.x0, clip.x0), y0: Math.max(b.y0, clip.y0), x1: Math.min(b.x1, clip.x1), y1: Math.min(b.y1, clip.y1) };
        return b && b.x0 < b.x1 && b.y0 < b.y1 ? b : null;
      }
      case "use": {
        const symbol = defs.get(String(n.href ?? "").replace(/^#/, ""));
        if (n.width != null && n.height != null) return rectBox(m, num(n.x), num(n.y), num(n.width), num(n.height));
        return symbol ? measure(symbol.children, multiplyMatrix(m, translate(num(n.x), num(n.y)))) : null;
      }
      case "image": return rectBox(m, num(n.x), num(n.y), num(n.width), num(n.height));
      case "rect": return filled(n) ? rectBox(m, num(n.x), num(n.y), num(n.width), num(n.height), stroke(n)) : null;
      case "circle": case "ellipse": {
        const rx = n.type === "circle" ? num(n.r) : num(n.rx), ry = n.type === "circle" ? num(n.r) : num(n.ry);
        return filled(n) ? rectBox(m, num(n.cx) - rx, num(n.cy) - ry, 2 * rx, 2 * ry, stroke(n)) : null;
      }
      case "path": return filled(n) ? pointsBox(m, pathPoints(n.d), stroke(n)) : null;
      case "text": return pointsBox(m, [[num(n.x), num(n.y)]]);
      default: return null;
    }
  }
  add(measure(node, matrix));
  return box;
}
