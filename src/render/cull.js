// Leaves out what lies wholly outside the picture (docs/rendering.md#culling). Besides saving work on a huge map, this keeps
// resvg alive: it aborts the whole process (a Rust panic, not an exception) on a layer (a clip, a filter, a mask, group opacity,
// or a nested <svg> such as every placed asset) that lies wholly outside a band of about twice the canvas around it.

/** How far around the viewport (a fraction of its size, per side) things are still drawn: well inside resvg's band. */
const MARGIN = 0.25;

/**
 * A test of whether an element can show in the viewport.
 * @param {{x:number, y:number, width:number, height:number, mapWidth:number}} viewport the drawn part of the map
 * @param {{mirrorX?: boolean, rotation?: number}} camera the outer transforms of `renderTfmSvg` (mirror, then camera rotation)
 * @returns {(box: {x:number, y:number, width?:number, height?:number}, place?: {x?:number, y?:number, rotation?:number, flip?:boolean}) => boolean}
 *   `box` is in the element's own coordinates (a missing size is a point), `place` its `translate(x y) rotate(r) scale(-1 1)`.
 */
export function createCuller(viewport, { mirrorX = false, rotation = 0 } = {}) {
  const left = viewport.x - viewport.width * MARGIN;
  const right = viewport.x + viewport.width * (1 + MARGIN);
  const top = viewport.y - viewport.height * MARGIN;
  const bottom = viewport.y + viewport.height * (1 + MARGIN);
  const cx = viewport.x + viewport.width / 2;
  const cy = viewport.y + viewport.height / 2;
  const camCos = Math.cos(rotation * Math.PI / 180);
  const camSin = Math.sin(rotation * Math.PI / 180);
  // transform="translate(mapWidth 0) scale(-1 1) rotate(r cx cy)": the rotation applies first, then the mirror.
  const camera = (x, y) => {
    let px = x, py = y;
    if (rotation) {
      const dx = x - cx, dy = y - cy;
      px = cx + dx * camCos - dy * camSin;
      py = cy + dx * camSin + dy * camCos;
    }
    return mirrorX ? [viewport.mapWidth - px, py] : [px, py];
  };
  return (box, { x = 0, y = 0, rotation: angle = 0, flip = false } = {}) => {
    const w = Number.isFinite(box.width) ? box.width : 0;
    const h = Number.isFinite(box.height) ? box.height : 0;
    if (!Number.isFinite(box.x) || !Number.isFinite(box.y)) return true;
    const c = Math.cos(angle * Math.PI / 180);
    const s = Math.sin(angle * Math.PI / 180);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const [lx0, ly] of [[box.x, box.y], [box.x + w, box.y], [box.x, box.y + h], [box.x + w, box.y + h]]) {
      const lx = flip ? -lx0 : lx0;
      const [px, py] = camera(x + lx * c - ly * s, y + lx * s + ly * c);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    return maxX >= left && minX <= right && maxY >= top && minY <= bottom;
  };
}

/** The box of an asset placed at its registration point (`imageElement(asset, -origin.x, -origin.y)`). */
export function assetBox(asset, x = 0, y = 0) {
  return { x: x - (asset?.origin?.x ?? 0), y: y - (asset?.origin?.y ?? 0), width: Number(asset?.width), height: Number(asset?.height) };
}
