// Rasterizer for the render service: SVG text in, PNG bytes out. resvg (native, no browser) is the only backend; the SVG root carries the final pixel size.

/** `@resvg/resvg-js` is an optional dependency: `npm install @resvg/resvg-js`. */
export async function createResvgRasterizer() {
  let mod;
  try {
    mod = await import("@resvg/resvg-js");
  } catch (error) {
    throw new Error("the render server needs the optional package @resvg/resvg-js (npm install @resvg/resvg-js)", { cause: error });
  }
  const { renderAsync } = mod.default ?? mod;
  return {
    name: "resvg",
    async rasterize(svg, { width, height }) {
      // renderAsync parses and draws on the libuv thread pool (UV_THREADPOOL_SIZE, default 4), so the event loop stays free and `concurrency` is real.
      const rendered = await renderAsync(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } });
      return { png: Buffer.from(rendered.asPng()), width: rendered.width, height: rendered.height };
    },
  };
}
