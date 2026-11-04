// Rasterizer for the render service: SVG text in, PNG bytes out. resvg (native, no browser) is the only backend; the SVG root carries the final pixel size.
// By default it runs in a pool of child processes (rasterize-worker.js): resvg aborts the whole process on some inputs (a Rust panic,
// not an exception; docs/rendering.md#culling), and in a child that costs one render instead of the server.
import { fork } from "node:child_process";

const WORKER = new URL("./rasterize-worker.js", import.meta.url);
const MISSING = "the render server needs the optional package @resvg/resvg-js (npm install @resvg/resvg-js)";

/** A child process ended while drawing (a resvg panic, or killed): the SVG is the likely cause. `status` 422 for the HTTP answer. */
export class RasterizerCrashError extends Error {
  constructor(message) { super(message); this.name = "RasterizerCrashError"; this.status = 422; }
}

/**
 * `@resvg/resvg-js` is an optional dependency: `npm install @resvg/resvg-js`.
 * @param {{processes?: number}} [config] child processes that rasterize (default 2); 0 rasterizes in this process (a resvg
 *   panic then ends it). Each child draws one picture at a time; further pictures wait for a free child.
 * @returns {Promise<{name: string, processes: number, rasterize: Function, close: Function, status: object}>}
 *   `rasterize(svg, { width, signal })`: aborting `signal` stops the picture (its child is killed and replaced).
 */
export async function createResvgRasterizer({ processes = 2 } = {}) {
  if (!(Number.isInteger(processes) && processes >= 0)) throw new TypeError("processes must be a whole number, 0 or more");
  if (processes === 0) return inProcessRasterizer();
  const pool = createPool(processes);
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

async function inProcessRasterizer() {
  let mod;
  try {
    mod = await import("@resvg/resvg-js");
  } catch (error) {
    throw new Error(MISSING, { cause: error });
  }
  const { renderAsync } = mod.default ?? mod;
  return {
    name: "resvg",
    processes: 0,
    async rasterize(svg, { width }) {
      // renderAsync parses and draws on the libuv thread pool (UV_THREADPOOL_SIZE, default 4), so the event loop stays free and `concurrency` is real.
      const rendered = await renderAsync(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } });
      return { png: Buffer.from(rendered.asPng()), width: rendered.width, height: rendered.height };
    },
    close() {},
    get status() { return { processes: 0 }; },
  };
}

function createPool(size) {
  const slots = Array.from({ length: size }, () => ({ child: null, ready: null, job: null }));
  const queue = [];
  let nextId = 1;
  let closed = false;

  // A child is ready once it has loaded resvg; `ready` rejects when it cannot.
  function spawn(slot) {
    const child = fork(WORKER, [], { serialization: "advanced", stdio: ["ignore", "inherit", "inherit", "ipc"] });
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
      finish(slot, job);
      if (message.error) job.reject(new Error(message.error));
      else job.resolve({ png: Buffer.from(message.png.buffer, message.png.byteOffset, message.png.byteLength), width: message.width, height: message.height });
    });
    child.on("exit", (code, signal) => {
      if (slot.child === child) { slot.child = null; slot.ready = null; }
      const job = slot.job;
      if (job) {
        finish(slot, job);
        job.reject(job.aborted ?? new RasterizerCrashError(`the rasterizer crashed on this picture (${signal ?? `exit code ${code}`})`));
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
    slot.child.send({ id: job.id, svg: job.svg, width: job.width });
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
      if (closed) return Promise.reject(new Error("the rasterizer is closed"));
      if (signal?.aborted) return Promise.reject(signal.reason);
      return new Promise((resolve, reject) => {
        const job = { id: nextId++, svg, width, signal, resolve, reject, aborted: null };
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
    },
    close() {
      closed = true;
      for (const job of queue.splice(0)) job.reject(new Error("the rasterizer is closed"));
      for (const slot of slots) slot.child?.kill("SIGKILL");
    },
    get status() {
      return { processes: size, busy: slots.filter((s) => s.job).length, queued: queue.length };
    },
  };
}
