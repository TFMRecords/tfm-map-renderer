// A tiny stroke font (digits, ".", "-", "×") for labels, drawn as paths: the server's rasteriser loads no fonts, and paths
// render the same everywhere. Glyphs are polylines on a 4 x 6 grid, y down.
import { attr } from "./svg-util.js";

const GLYPHS = Object.freeze({
  0: [[[0, 0], [4, 0], [4, 6], [0, 6], [0, 0]]],
  1: [[[1, 1], [2, 0], [2, 6]], [[1, 6], [3, 6]]],
  2: [[[0, 0], [4, 0], [4, 3], [0, 3], [0, 6], [4, 6]]],
  3: [[[0, 0], [4, 0], [4, 6], [0, 6]], [[0, 3], [4, 3]]],
  4: [[[0, 0], [0, 3], [4, 3]], [[4, 0], [4, 6]]],
  5: [[[4, 0], [0, 0], [0, 3], [4, 3], [4, 6], [0, 6]]],
  6: [[[4, 0], [0, 0], [0, 6], [4, 6], [4, 3], [0, 3]]],
  7: [[[0, 0], [4, 0], [4, 6]]],
  8: [[[0, 0], [4, 0], [4, 6], [0, 6], [0, 0]], [[0, 3], [4, 3]]],
  9: [[[4, 3], [0, 3], [0, 0], [4, 0], [4, 6], [0, 6]]],
  ".": [[[1.6, 6], [2.4, 6]]],
  "-": [[[0.5, 3], [3.5, 3]]],
  "×": [[[0.5, 2], [3.5, 5]], [[3.5, 2], [0.5, 5]]],
});
const ADVANCE = 5.5;
const round = (n) => Math.round(n * 100) / 100;

/** Path data of `text` (unknown characters are skipped), scaled so a digit is `height` tall, starting at (x, y) top left. */
export function glyphPath(text, { x = 0, y = 0, height = 9 } = {}) {
  const s = height / 6;
  const parts = [];
  let cx = x;
  for (const ch of String(text)) {
    for (const line of GLYPHS[ch] ?? []) parts.push(line.map(([gx, gy], i) => `${i ? "L" : "M"}${round(cx + gx * s)} ${round(y + gy * s)}`).join(""));
    cx += ADVANCE * s;
  }
  return parts.join("");
}

/** Width of `text` at `height`, without the trailing gap. */
export function glyphWidth(text, height = 9) {
  const n = [...String(text)].length;
  return n ? ((n - 1) * ADVANCE + 4) * (height / 6) : 0;
}

/**
 * A readable label: white strokes over a dark outline. `anchor` "start", "middle" or "end" places it horizontally around `x`;
 * `y` is the vertical centre.
 */
export function glyphLabel(text, { x = 0, y = 0, height = 9, anchor = "start", color = "#ffffff", outline = "#1b1f2b" } = {}) {
  const width = glyphWidth(text, height);
  const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  const d = glyphPath(text, { x: left, y: y - height / 2, height });
  if (!d) return "";
  const stroke = Math.max(1, height / 6);
  const common = `${attr("d", d)}${attr("fill", "none")}${attr("stroke-linecap", "round")}${attr("stroke-linejoin", "round")}`;
  return `<path${common}${attr("stroke", outline)}${attr("stroke-width", round(stroke * 2.6))}/><path${common}${attr("stroke", color)}${attr("stroke-width", round(stroke))}/>`;
}
