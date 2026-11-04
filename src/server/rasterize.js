// Rasterizer for the render service: PNG bytes out of SVG text (resvg, native, no browser; the SVG root carries the final pixel size)
// or out of a scene (the PNG compositor of src/raster, its pictures rasterised by resvg).
// By default it runs in a pool of child processes (rasterize-worker.js): resvg aborts the whole process on some inputs (a Rust panic,
// not an exception; docs/rendering.md#culling), and in a child that costs one render instead of the server. A scene whose child
// crashed is drawn once more in a new child with whole pictures (the compositor crops large pictures, and resvg can panic on a crop).
import { fork } from "node:child_process";
import { packScene } from "./scene-transfer.js";
import { renderScenePng, createPictureCache } from "../raster/index.js";

const WORKER = new URL("./rasterize-worker.js", import.meta.url);

/**
 * The parent's Node flags for a child, without the script of `node -e` / `-p` (Node keeps it in execArgv: the child would run it
 * again, and a script that starts a pool would start pools without end) and `--input-type` (refused for a file).
 */
export function childExecArgv(argv = process.execArgv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-e" || arg === "--eval" || arg === "-p" || arg === "--print" || arg === "-pe") { i++; continue; }
    if (/^(--eval|--print|--input-type)(=|$)/.test(arg)) continue;
    out.push(arg);
  }
  return out;
}
const MISSING = "the render server needs the optional package @resvg/resvg-js (npm install @resvg/resvg-js)";

/** A child process ended while drawing (a resvg panic, or killed): the SVG is the likely cause. `status` 422 for the HTTP answer. */
export class RasterizerCrashError extends Error {
  constructor(message) { super(message); this.name = "RasterizerCrashError"; this.status = 422; }
}

/**
 * `@resvg/resvg-js` is an optional dependency: `npm install @resvg/resvg-js`.
 * @param {{processes?: number, pictureCacheBytes?: number}} [config] child processes that rasterize (default 2); 0 rasterizes in
 *   this process (a resvg panic then ends it). Each child draws one picture at a time; further pictures wait for a free child.
 *   `pictureCacheBytes`: the compositor's picture cache in each child (default 256 MB, src/raster/pictures.js)
 * @returns {Promise<{name: string, processes: number, rasterize: Function, renderScene: Function, close: Function, status: object}>}
 *   `rasterize(svg, { width, signal })`: aborting `signal` stops the picture (its child is killed and replaced).
 *   `renderScene(scene, { width, height, signal })`: the PNG compositor, the scene stretched to width x height; the result has
 *   `renderer` "compositor", or "resvg" with `unsupported` when the scene holds what the compositor cannot draw
 */
export async function createResvgRasterizer({ processes = 2, pictureCacheBytes } = {}) {
  if (!(Number.isInteger(processes) && processes >= 0)) throw new TypeError("processes must be a whole number, 0 or more");
  if (processes === 0) return inProcessRasterizer({ pictureCacheBytes });
  const pool = createPool(processes, { pictureCacheBytes });
  try {
    await pool.start();
  } catch (error) {
    pool.close();
    throw error;
  }
  return pool;
}

/**
 * The `rasterize` function of a picture cache (src/raster/pictures.js) on resvg, in this process: SVG text in, premultiplied
 * RGBA pixels out. Used where the PNG compositor runs (a child of the pool), since a resvg panic ends the process.
 * @returns {Promise<(svg: string) => {pixels: Uint8Array, width: number, height: number}>}
 */
export async function loadResvgPixels() {
  let mod;
  try {
    mod = await import("@resvg/resvg-js");
  } catch (error) {
    throw new Error(MISSING, { cause: error });
  }
  const { Resvg } = mod.default ?? mod;
  return (svg) => {
    const rendered = new Resvg(svg, { font: { loadSystemFonts: false } }).render();
    return { pixels: rendered.pixels, width: rendered.width, height: rendered.height };
  };
}

async function inProcessRasterizer({ pictureCacheBytes }) {
  let mod;
  try {
    mod = await import("@resvg/resvg-js");
  } catch (error) {
    throw new Error(MISSING, { cause: error });
  }
  const { renderAsync } = mod.default ?? mod;
  // Whole pictures only: a panic on a crop would end the server. The compositor draws on the event loop here.
  const pictures = createPictureCache({ rasterize: await loadResvgPixels(), crop: false, ...(pictureCacheBytes ? { maxBytes: pictureCacheBytes } : {}) });
  return {
    name: "resvg",
    processes: 0,
    async rasterize(svg, { width }) {
      // renderAsync parses and draws on the libuv thread pool (UV_THREADPOOL_SIZE, default 4), so the event loop stays free and `concurrency` is real.
      const rendered = await renderAsync(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } });
      return { png: Buffer.from(rendered.asPng()), width: rendered.width, height: rendered.height };
    },
    async renderScene(scene, { width, height }) {
      const result = await renderScenePng(scene, { pictures, width, height, fit: "fill" });
      if (Object.keys(result.unsupported).length) throw new Error(`the compositor cannot draw ${Object.keys(result.unsupported).join(", ")}`);
      return { png: result.png, width: result.width, height: result.height, renderer: "compositor" };
    },
    close() {},
    get status() { return { processes: 0 }; },
  };
}

function createPool(size, { pictureCacheBytes }) {
  const slots = Array.from({ length: size }, () => ({ child: null, ready: null, job: null, rss: 0 }));
  const queue = [];
  let nextId = 1;
  let closed = false;
  let retries = 0;
  const env = pictureCacheBytes ? { ...process.env, TFM_PICTURE_CACHE_BYTES: String(pictureCacheBytes) } : process.env;

  // A child is ready once it has loaded resvg; `ready` rejects when it cannot.
  function spawn(slot) {
    const child = fork(WORKER, [], { serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"], env, execArgv: childExecArgv() });
    slot.child = child;
    slot.ready = new Promise((resolve, reject) => {
      child.once("message", (message) => {
        if (message?.type === "ready") resolve();
        else reject(new Error(message?.type === "failed" ? `${MISSING}: ${message.message}` : "rasterizer process failed to start"));
      });
      child.once("exit", () => reject(new Error("rasterizer process exited while starting")));
    });
    slot.ready.catch(() => {});
    // A send to a child that just died: its exit handler deals with the job.
    child.on("error", () => {});
    child.on("message", (message) => {
      const job = slot.job;
      if (!job || message?.id !== job.id) return;
      slot.rss = message.rss ?? 0;
      finish(slot, job);
      if (message.error) job.reject(new Error(message.error));
      else {
        const result = { png: Buffer.from(message.png.buffer, message.png.byteOffset, message.png.byteLength), width: message.width, height: message.height };
        job.resolve(job.scene ? { ...result, renderer: message.renderer, ...(message.unsupported ? { unsupported: message.unsupported } : {}), ...(job.crop === false ? { retried: true } : {}) } : result);
      }
    });
    child.on("exit", (code, signal) => {
      if (slot.child === child) { slot.child = null; slot.ready = null; slot.rss = 0; }
      const job = slot.job;
      if (job) {
        finish(slot, job);
        if (job.scene && job.crop !== false && !job.aborted && !closed) {
          // Likely a resvg panic on a cropped picture: once more, first in line, with whole pictures.
          job.crop = false;
          retries++;
          queue.unshift(job);
          job.signal?.addEventListener("abort", job.onAbort, { once: true });
        } else {
          job.reject(job.aborted ?? new RasterizerCrashError(`the rasterizer crashed on this picture (${signal ?? `exit code ${code}`})`));
        }
      }
      pump();
    });
  }

  function finish(slot, job) {
    slot.job = null;
    job.signal?.removeEventListener("abort", job.onAbort);
    queueMicrotask(pump);
  }

  async function run(slot, job) {
    slot.job = job;
    try {
      if (!slot.child) spawn(slot);
      await slot.ready;
    } catch (error) {
      if (slot.job === job) { finish(slot, job); job.reject(error); }
      return;
    }
    if (slot.job !== job || job.aborted) return; // aborted while the child was starting (its exit handler rejects the job)
    slot.child.send(job.scene ? { id: job.id, scene: job.scene, width: job.width, height: job.height, crop: job.crop } : { id: job.id, svg: job.svg, width: job.width });
  }

  function pump() {
    if (closed) return;
    for (const slot of slots) {
      if (!queue.length) return;
      if (!slot.job) run(slot, queue.shift());
    }
  }

  return {
    name: "resvg",
    processes: size,
    async start() {
      for (const slot of slots) spawn(slot);
      await Promise.all(slots.map((slot) => slot.ready));
    },
    rasterize(svg, { width, signal } = {}) {
      return enqueue({ svg, width }, signal);
    },
    renderScene(scene, { width, height, signal } = {}) {
      return enqueue({ scene: packScene(scene), width, height, crop: true }, signal);
    },
    close() {
      closed = true;
      for (const job of queue.splice(0)) job.reject(new Error("the rasterizer is closed"));
      for (const slot of slots) slot.child?.kill("SIGKILL");
    },
    get status() {
      // `memoryMB`: each child's resident memory after its last picture (the compositor's picture cache lives there).
      return { processes: size, busy: slots.filter((s) => s.job).length, queued: queue.length, retries, memoryMB: slots.map((s) => Math.round(s.rss / 1048576)) };
    },
  };

  function enqueue(fields, signal) {
    if (closed) return Promise.reject(new Error("the rasterizer is closed"));
    if (signal?.aborted) return Promise.reject(signal.reason);
    return new Promise((resolve, reject) => {
      const job = { id: nextId++, ...fields, signal, resolve, reject, aborted: null };
      job.onAbort = () => {
        job.aborted = signal.reason ?? new Error("aborted");
        const queued = queue.indexOf(job);
        if (queued >= 0) { queue.splice(queued, 1); reject(job.aborted); return; }
        const slot = slots.find((s) => s.job === job);
        // Killing the child stops the work; its exit handler rejects the job with `aborted` and a new child is started on demand.
        if (slot?.child) slot.child.kill("SIGKILL");
        else if (slot) { finish(slot, job); reject(job.aborted); }
      };
      signal?.addEventListener("abort", job.onAbort, { once: true });
      queue.push(job);
      pump();
    });
  }
}
