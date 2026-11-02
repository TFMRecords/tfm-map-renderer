// Flash's blur filters as SVG filter primitives.
//
// A Flash BlurFilter / GlowFilter of size `blur` and quality `passes` is `passes` box blurs of width `blur` in each direction (quality 3 =
// three passes), NOT a Gaussian. The result is close to a Gaussian of the same variance, passes * (blur^2 - 1) / 12, but its edge is steeper
// and it ends after passes * blur / 2 pixels. FFDec exports the filters as chains of `feGaussianBlur` with that variance split over the
// passes (`stdDeviation = sqrt((blur^2 - 1) / 12)` per pass, which is how `blur` can be recovered); `flashBlurChains` swaps such chains for the
// exact box blurs, built from `feConvolveMatrix`.

/** One box blur of width `width` along an axis: an `feConvolveMatrix` of ones. `shift` (even widths only) picks which side the extra tap falls on. */
function boxPrimitive(width, horizontal, input, result, shift) {
  const target = Math.floor(width / 2) - (width % 2 === 0 && shift ? 1 : 0);
  return `<feConvolveMatrix in="${input}" result="${result}" order="${horizontal ? `${width} 1` : `1 ${width}`}" kernelMatrix="${Array(width).fill(1).join(" ")}" divisor="${width}"`
    + ` ${horizontal ? `targetX="${target}" targetY="0"` : `targetX="0" targetY="${target}"`} edgeMode="none" preserveAlpha="false"/>`;
}

/**
 * The primitives of a Flash blur of size `blurX` x `blurY` (pixels, whole numbers; 1 or less leaves that axis alone) and quality `passes`.
 * @param {string} input name of the input result (`SourceAlpha`, a previous `result`, ...)
 * @param {string} result name of the final result
 * @param {string} prefix unique prefix for the intermediate results
 */
export function flashBlurPrimitives(blurX, blurY, passes, input, result, prefix) {
  const steps = [];
  for (let pass = 0; pass < passes; pass++) {
    if (blurX > 1) steps.push([blurX, true, pass % 2 === 1]);
    if (blurY > 1) steps.push([blurY, false, pass % 2 === 1]);
  }
  if (!steps.length) return `<feOffset in="${input}" dx="0" dy="0" result="${result}"/>`;
  let current = input;
  return steps.map(([width, horizontal, shift], i) => {
    const out = i === steps.length - 1 ? result : `${prefix}${i}`;
    const primitive = boxPrimitive(width, horizontal, current, out, shift);
    current = out;
    return primitive;
  }).join("");
}

/** Box width whose single-pass Gaussian standard deviation is `sigma` (`sigma^2 = (w^2 - 1) / 12`), when that is a whole number of at least 2. */
function widthOfSigma(sigma) {
  const w = Math.sqrt(12 * sigma * sigma + 1);
  const rounded = Math.round(w);
  return rounded >= 2 && Math.abs(w - rounded) < 0.02 ? rounded : null;
}

const GAUSSIAN = '<feGaussianBlur in="([^"]*)" result="([^"]*)" stdDeviation="([\\d.]+)(?: ([\\d.]+))?"/>';

/**
 * Replaces every run of two or more `feGaussianBlur` primitives that chain into each other with the same `stdDeviation` (FFDec's export of a Flash
 * filter of quality 2 or 3) by the exact box blurs. Runs whose deviation does not correspond to a whole box width are left alone.
 */
export function flashBlurChains(markup) {
  if (!markup.includes("<feGaussianBlur")) return markup;
  const re = new RegExp(`(?:${GAUSSIAN}){2,}`, "g");
  let n = 0;
  return markup.replace(re, (run) => {
    const items = [...run.matchAll(new RegExp(GAUSSIAN, "g"))].map((m) => ({ input: m[1], result: m[2], sx: Number(m[3]), sy: m[4] === undefined ? Number(m[3]) : Number(m[4]) }));
    const first = items[0];
    if (items.some((it, i) => it.sx !== first.sx || it.sy !== first.sy || (i > 0 && it.input !== items[i - 1].result))) return run;
    const wx = first.sx === 0 ? 1 : widthOfSigma(first.sx);
    const wy = first.sy === 0 ? 1 : widthOfSigma(first.sy);
    if (wx == null || wy == null) return run;
    return flashBlurPrimitives(wx, wy, items.length, first.input, items[items.length - 1].result, `fb${n++}_`);
  });
}
