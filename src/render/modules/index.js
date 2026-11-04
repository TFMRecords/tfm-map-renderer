// Overlays for Lua modules (docs/api/renderer.md#modules): what a module's map data means, drawn on top of the map. Each
// module is "auto" by default (drawn when the parser detected one of its maps), `true` to force it, `false` to turn it off.
import { renderParkour } from "./parkour.js";

/** Module name -> renderer of its `map.modules[name]` data. */
export const RENDER_MODULES = Object.freeze({ parkour: renderParkour });

/** `{ parkour: "auto" | true | false, ... }` from the `modules` option (`false` turns every module off). */
export function resolveModuleOptions(value) {
  const out = Object.fromEntries(Object.keys(RENDER_MODULES).map((name) => [name, "auto"]));
  if (value === false) for (const name of Object.keys(out)) out[name] = false;
  else if (value && typeof value === "object") {
    for (const [name, setting] of Object.entries(value)) {
      if (!(name in out)) throw new TypeError(`unknown module "${name}" in options.modules`);
      if (setting !== "auto" && setting !== true && setting !== false) throw new TypeError(`options.modules.${name} must be "auto", true or false`);
      out[name] = setting;
    }
  }
  return out;
}

/** The overlays of every enabled module, in registry order (scene nodes). */
export function renderModules(map, modules, context) {
  return Object.entries(RENDER_MODULES).map(([name, render]) => {
    const data = map.modules?.[name];
    const setting = modules[name];
    if (!data || setting === false || (setting === "auto" && !data.detected)) return null;
    return render(data, context);
  });
}
