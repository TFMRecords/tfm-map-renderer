// Pixel comparison of a render with a screenshot of the real game: alignment, overall and per-region error. Pure functions on RGBA images
// (`{width, height, data}`); the CLI is tools/compare-screenshot.mjs.

/** Root-mean-square channel difference (RGB) of `region` of `a` at (0,0) against `b` shifted by (dx, dy); only the overlapping pixels count. */
export function rmse(a, b, region, dx = 0, dy = 0, step = 1) {
  let sum = 0, n = 0;
  const x0 = Math.max(region.x, 0, -dx), x1 = Math.min(region.x + region.w, a.width, b.width - dx);
  const y0 = Math.max(region.y, 0, -dy), y1 = Math.min(region.y + region.h, a.height, b.height - dy);
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      const i = (y * a.width + x) * 4;
      const j = ((y + dy) * b.width + (x + dx)) * 4;
      const r = a.data[i] - b.data[j], g = a.data[i + 1] - b.data[j + 1], bl = a.data[i + 2] - b.data[j + 2];
      sum += r * r + g * g + bl * bl;
      n++;
    }
  }
  return n ? { rmse: Math.sqrt(sum / (3 * n)), pixels: n } : { rmse: Infinity, pixels: 0 };
}

/** The most common colour of an image (the room colour behind everything), as `[r, g, b]`. */
export function backgroundColor(image) {
  const counts = new Map();
  for (let i = 0; i < image.data.length; i += 4 * 7) {
    const key = (image.data[i] << 16) | (image.data[i + 1] << 8) | image.data[i + 2];
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const [key] = [...counts].sort((a, b) => b[1] - a[1])[0];
  return [(key >> 16) & 255, (key >> 8) & 255, key & 255];
}

/**
 * Where `ours` sits inside `shot`: the (dx, dy) that minimises the error over the pixels of `ours` that are not the background colour (a flat background matches
 * everywhere, so it must not decide), searched coarsely on a sub-sampled grid and then refined. At least `minCoverage` of those pixels must land inside
 * the screenshot (it may be a crop of the game window, anywhere around the map). Rows of `ours` in `ignoreTop` / `ignoreBottom` (the game draws its own bars there)
 * do not take part.
 * @returns {{dx:number, dy:number, rmse:number, pixels:number, coverage:number}}
 */
export function alignImages(ours, shot, { range = null, ignoreTop = 24, ignoreBottom = 20, minCoverage = 0.3 } = {}) {
  range ??= { x: [-ours.width, shot.width], y: [-ours.height, shot.height] };
  const bg = backgroundColor(ours);
  const yEnd = ours.height - ignoreBottom;
  const points = (step) => {
    const list = [];
    for (let y = ignoreTop; y < yEnd; y += step) for (let x = 0; x < ours.width; x += step) {
      const i = (y * ours.width + x) * 4;
      if (ours.data[i] !== bg[0] || ours.data[i + 1] !== bg[1] || ours.data[i + 2] !== bg[2]) list.push(i);
    }
    return list;
  };
  const coarse = points(3), fine = points(1);
  if (!fine.length) throw new Error("the render is all background: nothing to align");
  const score = (list, dx, dy) => {
    let sum = 0, n = 0;
    for (const i of list) {
      const p = i >> 2;
      const x = (p % ours.width) + dx, y = Math.floor(p / ours.width) + dy;
      if (x < 0 || y < 0 || x >= shot.width || y >= shot.height) continue;
      const j = (y * shot.width + x) * 4;
      const r = ours.data[i] - shot.data[j], g = ours.data[i + 1] - shot.data[j + 1], b = ours.data[i + 2] - shot.data[j + 2];
      sum += r * r + g * g + b * b;
      n++;
    }
    const coverage = n / list.length;
    return coverage < minCoverage ? { rmse: Infinity, pixels: n, coverage } : { rmse: Math.sqrt(sum / (3 * n)), pixels: n, coverage };
  };
  let best = { dx: 0, dy: 0, rmse: Infinity, pixels: 0, coverage: 0 };
  for (let dy = range.y[0]; dy <= range.y[1]; dy += 3) {
    for (let dx = range.x[0]; dx <= range.x[1]; dx += 3) {
      const r = score(coarse, dx, dy);
      if (r.rmse < best.rmse) best = { dx, dy, ...r };
    }
  }
  const centre = best;
  for (let dy = centre.dy - 4; dy <= centre.dy + 4; dy++) {
    for (let dx = centre.dx - 4; dx <= centre.dx + 4; dx++) {
      const r = score(fine, dx, dy);
      if (r.rmse < best.rmse || best === centre) best = { dx, dy, ...r };
    }
  }
  return best;
}

/** Error of each region after a small local re-alignment (`slack` pixels each way): `{ ...region, rmse, dx, dy }` (dx, dy relative to the global offset). */
export function regionErrors(ours, shot, offset, regions, slack = 3) {
  return regions.map((region) => {
    let best = { rmse: Infinity, dx: 0, dy: 0 };
    for (let dy = -slack; dy <= slack; dy++) {
      for (let dx = -slack; dx <= slack; dx++) {
        const r = rmse(ours, shot, region, offset.dx + dx, offset.dy + dy);
        if (r.rmse < best.rmse) best = { rmse: r.rmse, dx, dy };
      }
    }
    return { ...region, ...best };
  });
}

/** An RGBA image of the absolute difference (amplified `gain` times) of `ours` against `shot` at `offset`; pixels outside the screenshot are grey. */
export function diffImage(ours, shot, offset, gain = 4) {
  const data = new Uint8ClampedArray(ours.width * ours.height * 4);
  for (let y = 0; y < ours.height; y++) {
    for (let x = 0; x < ours.width; x++) {
      const i = (y * ours.width + x) * 4;
      const sx = x + offset.dx, sy = y + offset.dy;
      if (sx < 0 || sy < 0 || sx >= shot.width || sy >= shot.height) { data[i] = data[i + 1] = data[i + 2] = 128; data[i + 3] = 255; continue; }
      const j = (sy * shot.width + sx) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.min(255, Math.abs(ours.data[i + c] - shot.data[j + c]) * gain);
      data[i + 3] = 255;
    }
  }
  return { width: ours.width, height: ours.height, data };
}

/** Boxes (map coordinates) around the elements of a parsed map: grounds by their size, everything else by a fixed half-size (the clip sizes are not in the map). */
export function autoRegions(map, { half = 40, mirrorWidth = null } = {}) {
  const boxes = [];
  // `mirrorWidth`: the map width, when the render is mirrored (the elements then sit at width - x)
  const box = (label, cx, cy, w, h) => boxes.push({ label, x: Math.round((mirrorWidth == null ? cx : mirrorWidth - cx) - w / 2), y: Math.round(cy - h / 2), w: Math.round(w), h: Math.round(h) });
  for (const [i, g] of (map.grounds ?? []).entries()) {
    const w = g.derived?.width ?? g.width ?? 0, h = g.derived?.height ?? g.height ?? 0;
    const r = Math.hypot(w, h);
    box(`ground ${i} (T${g.type})`, g.x, g.y, g.rotation ? r : w + 4, g.rotation ? r : h + 4);
  }
  for (const [i, d] of (map.decorations ?? []).entries()) if (["decoration", "hole", "cheese"].includes(d.role)) box(`${d.role} ${i}${d.type != null ? ` (T${d.type})` : ""}`, d.x, d.y - half / 2, half * 2, half * 2);
  for (const [i, o] of (map.objects ?? []).entries()) box(`object ${i} (C${o.type})`, o.x, o.y, half * 1.5, half * 1.5);
  return boxes;
}
