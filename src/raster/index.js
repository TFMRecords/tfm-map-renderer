// The PNG compositor (docs/rendering.md#png-compositor): a scene drawn strip by strip and written as a PNG as it goes.
import { renderSceneStrips, sceneSize } from "./compositor.js";
import { createPngWriter } from "../util/png.js";

export { renderSceneStrips, flattenScene, sceneSize, transformMatrix, parseColor } from "./compositor.js";
export { createPictureCache } from "./pictures.js";

/**
 * The PNG of a scene. Memory: one strip of working pixels, the picture cache and the compressed PNG.
 * @param {object} scene the root node of `renderTfmScene`
 * @param {{pictures: object, width?: number, height?: number, stripBytes?: number, level?: number}} options as for
 *   `renderSceneStrips`; `level` the zlib level of the PNG (default 6)
 * @returns {Promise<{png: Buffer, width: number, height: number, unsupported: object}>}
 */
export async function renderScenePng(scene, { level, ...options }) {
  const writer = createPngWriter({ ...sceneSize(scene, options), level });
  const result = await renderSceneStrips(scene, { ...options, onStrip: (rgba, y, rows) => writer.write(rgba, rows) });
  return { png: await writer.finish(), ...result };
}
