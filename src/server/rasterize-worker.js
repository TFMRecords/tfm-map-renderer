// One child process of the rasterizer pool (rasterize.js): SVG in, PNG out, one job at a time. resvg runs here and not in the
// server, so a resvg panic (it aborts the process) ends only this child.
let renderAsync;
try {
  const mod = await import("@resvg/resvg-js");
  ({ renderAsync } = mod.default ?? mod);
} catch (error) {
  process.send({ type: "failed", message: error.message });
  process.exit(1);
}

process.on("message", async ({ id, svg, width }) => {
  try {
    const rendered = await renderAsync(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } });
    process.send({ id, png: rendered.asPng(), width: rendered.width, height: rendered.height });
  } catch (error) {
    process.send({ id, error: error.message });
  }
});
// The server is gone: nothing left to do.
process.on("disconnect", () => process.exit(0));
process.send({ type: "ready" });
