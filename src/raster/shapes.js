// Geometry of the PNG compositor (compositor.js): paths, strokes and fills as coverage masks, dashes, and Flash's box blur.
// A mask is a Float32Array over an area { x0, y0, x1, y1 } of device pixels, one coverage value (0 to 1) per pixel.

/**
 * The subpaths of an SVG path with straight segments only (M, L, H, V, Z and their relative forms): what the scene's
 * paths use (joints, labels, the offscreen frame). null for anything else (curves, arcs).
 * @returns {{points: number[][], closed: boolean}[]|null}
 */
export function parsePath(d) {
  const tokens = String(d ?? "").match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const subpaths = [];
  let current = null, x = 0, y = 0, command = null, i = 0;
  const number = () => {
    const n = Number(tokens[i++]);
    if (!Number.isFinite(n)) throw new SyntaxError("bad number in path");
    return n;
  };
  const moveTo = (nx, ny) => {
    x = nx; y = ny;
    current = { points: [[x, y]], closed: false };
    subpaths.push(current);
  };
  const lineTo = (nx, ny) => {
    x = nx; y = ny;
    if (!current) moveTo(x, y); else current.points.push([x, y]);
  };
  try {
    while (i < tokens.length) {
      if (/^[a-zA-Z]$/.test(tokens[i])) command = tokens[i++];
      else if (command === null) return null;
      switch (command) {
        case "M": moveTo(number(), number()); command = "L"; break;
        case "m": { const dx = number(), dy = number(); moveTo(x + dx, y + dy); command = "l"; break; }
        case "L": lineTo(number(), number()); break;
        case "l": { const dx = number(), dy = number(); lineTo(x + dx, y + dy); break; }
        case "H": lineTo(number(), y); break;
        case "h": lineTo(x + number(), y); break;
        case "V": lineTo(x, number()); break;
        case "v": lineTo(x, y + number()); break;
        case "Z":
        case "z":
          if (current) {
            current.closed = true;
            [x, y] = current.points[0];
            current = null;
          }
          command = null;
          break;
        default:
          return null;
      }
    }
  } catch {
    return null;
  }
  return subpaths;
}

/**
 * The straight segments of a polyline, cut into dashes when `dashes` (lengths, on and off in turn) is given.
 * @returns {number[][]} [x0, y0, x1, y1] each
 */
export function dashSegments(points, closed, dashes = null) {
  const pts = closed && points.length > 1 ? [...points, points[0]] : points;
  const out = [];
  if (!dashes?.length || dashes.every((n) => !(n > 0))) {
    for (let i = 1; i < pts.length; i++) out.push([pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]]);
    if (pts.length === 1) out.push([pts[0][0], pts[0][1], pts[0][0], pts[0][1]]);
    return out;
  }
  const pattern = dashes.length % 2 ? [...dashes, ...dashes] : dashes;
  let k = 0, left = pattern[0], on = true;
  for (let i = 1; i < pts.length; i++) {
    let [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    let length = Math.hypot(x1 - x0, y1 - y0);
    const ux = length ? (x1 - x0) / length : 0, uy = length ? (y1 - y0) / length : 0;
    while (length > 0) {
      const step = Math.min(left, length);
      if (on) out.push([x0, y0, x0 + ux * step, y0 + uy * step]);
      x0 += ux * step; y0 += uy * step; length -= step; left -= step;
      if (left <= 1e-9) { k = (k + 1) % pattern.length; left = pattern[k]; on = k % 2 === 0; }
    }
  }
  return out;
}

/**
 * Adds the coverage of a stroke made of `segments` (device pixels) of half width `hw` and line cap `cap` ("butt", "round" or
 * "square") to `mask`, keeping the larger value where segments overlap (a stroke is painted once). Round caps also make the
 * joins round.
 */
export function strokeMask(mask, area, segments, hw, cap) {
  const width = area.x1 - area.x0;
  const thin = 2 * hw < 1 ? 2 * hw : 1; // a line thinner than a pixel covers at most its width
  const ext = cap === "square" ? hw : 0;
  const reach = hw + 1;
  for (const [x0, y0, x1, y1] of segments) {
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (!length && cap === "butt") continue;
    const ux = length ? (x1 - x0) / length : 1, uy = length ? (y1 - y0) / length : 0;
    const top = Math.max(area.y0, Math.floor(Math.min(y0, y1) - reach)), bottom = Math.min(area.y1, Math.ceil(Math.max(y0, y1) + reach));
    for (let py = top; py < bottom; py++) {
      const Y = py + 0.5, ry = Y - y0;
      // The columns this row can touch: |n| <= reach across the segment, -reach <= t <= length + reach along it.
      let lo = area.x0, hi = area.x1;
      if (Math.abs(uy) > 1e-9) {
        const a = x0 + (ry * ux - reach) / uy, b = x0 + (ry * ux + reach) / uy;
        lo = Math.max(lo, Math.floor(Math.min(a, b))); hi = Math.min(hi, Math.ceil(Math.max(a, b)) + 1);
      } else if (Math.abs(ry * ux) > reach) continue;
      if (Math.abs(ux) > 1e-9) {
        const a = x0 + (-reach - ry * uy) / ux, b = x0 + (length + reach - ry * uy) / ux;
        lo = Math.max(lo, Math.floor(Math.min(a, b))); hi = Math.min(hi, Math.ceil(Math.max(a, b)) + 1);
      } else if (ry * uy < -reach || ry * uy > length + reach) continue;
      const row = (py - area.y0) * width - area.x0;
      for (let px = lo; px < hi; px++) {
        const rx = px + 0.5 - x0;
        const t = rx * ux + ry * uy, n = -rx * uy + ry * ux;
        let c;
        if (cap === "round") {
          const tc = t < 0 ? 0 : t > length ? length : t;
          c = hw - Math.hypot(t - tc, n) + 0.5;
        } else {
          c = Math.min(hw - Math.abs(n) + 0.5, t + ext + 0.5, length + ext - t + 0.5);
        }
        if (c <= 0) continue;
        if (c > thin) c = thin;
        if (c > mask[row + px]) mask[row + px] = c;
      }
    }
  }
}

/**
 * Adds the coverage of filled subpaths (device pixels, closed implicitly) with `rule` "nonzero" or "evenodd" to `mask`:
 * four sub-rows per pixel row, exact across each sub-row.
 */
export function fillMask(mask, area, subpaths, rule) {
  const width = area.x1 - area.x0;
  const edges = [];
  for (const { points } of subpaths) {
    for (let i = 0; i < points.length; i++) {
      const [ax, ay] = points[i], [bx, by] = points[(i + 1) % points.length];
      if (ay !== by) edges.push([ax, ay, bx, by]);
    }
  }
  const crossings = [];
  for (let py = area.y0; py < area.y1; py++) {
    const row = (py - area.y0) * width;
    for (let sub = 0; sub < 4; sub++) {
      const Y = py + (sub + 0.5) / 4;
      crossings.length = 0;
      for (const [ax, ay, bx, by] of edges) {
        if ((Y < ay) === (Y < by)) continue;
        crossings.push([ax + ((Y - ay) * (bx - ax)) / (by - ay), by > ay ? 1 : -1]);
      }
      if (crossings.length < 2) continue;
      crossings.sort((p, q) => p[0] - q[0]);
      let winding = 0;
      for (let k = 0; k < crossings.length - 1; k++) {
        winding += crossings[k][1];
        if (rule === "evenodd" ? (k + 1) % 2 === 0 : winding === 0) continue;
        const xa = Math.max(area.x0, crossings[k][0]), xb = Math.min(area.x1, crossings[k + 1][0]);
        if (xa >= xb) continue;
        const ia = Math.floor(xa), ib = Math.floor(xb);
        if (ia === ib) { mask[row + ia - area.x0] += (xb - xa) / 4; continue; }
        mask[row + ia - area.x0] += (ia + 1 - xa) / 4;
        for (let x = ia + 1; x < ib; x++) mask[row + x - area.x0] += 0.25;
        if (ib < area.x1) mask[row + ib - area.x0] += (xb - ib) / 4;
      }
    }
  }
}

/**
 * Coverage of a dash pattern at `pos` along a line (`scale` device pixels per unit): 1 inside a dash, 0 in a gap, smoothed
 * across its ends.
 */
export function dashCoverage(pos, pattern, scale) {
  const period = pattern.reduce((s, n) => s + n, 0);
  if (!(period > 0)) return 1;
  let p = pos % period;
  if (p < 0) p += period;
  for (let k = 0, start = 0; k < pattern.length; start += pattern[k], k++) {
    const end = start + pattern[k];
    if (p < end || k === pattern.length - 1) {
      const d = Math.min(p - start, end - p) * scale;
      return k % 2 === 0 ? Math.min(1, d + 0.5) : Math.max(0, 0.5 - d);
    }
  }
  return 1;
}

/**
 * One pass of a box blur of `width` pixels along rows (`horizontal`) or columns of a w x h channel, as Flash and
 * src/util/flash-blur.js do: the window of pixel x is [x - target, x - target + width - 1], target = floor(width / 2), one less
 * for even widths on `shift` passes; pixels outside are 0.
 */
export function boxBlur(channel, w, h, width, horizontal, shift) {
  if (width <= 1) return;
  const target = Math.floor(width / 2) - (width % 2 === 0 && shift ? 1 : 0);
  const n = horizontal ? w : h, lines = horizontal ? h : w;
  const step = horizontal ? 1 : w, lineStep = horizontal ? w : 1;
  const line = new Float32Array(n);
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    for (let i = 0; i < n; i++) line[i] = channel[base + i * step];
    let sum = 0;
    // The window of x = 0 is [-target, width - 1 - target].
    for (let i = 0; i <= width - 1 - target && i < n; i++) sum += line[i];
    for (let x = 0; x < n; x++) {
      channel[base + x * step] = sum / width;
      const add = x + width - target, drop = x - target;
      if (add < n) sum += line[add];
      if (drop >= 0) sum -= line[drop];
    }
  }
}
