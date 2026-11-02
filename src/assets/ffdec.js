import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile, rename, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolve } from "node:path";
import { readZip, safeEntryPath } from "../util/zip.js";

// Pinned FFDec (JPEXS Free Flash Decompiler) release. The digest is the SHA-256 of the portable
// ffdec_<version>.zip as published on GitHub and re-verified by downloading it.
export const FFDEC_RELEASE = Object.freeze({
  version: "26.3.0",
  url: "https://github.com/jindrapetrik/jpexs-decompiler/releases/download/version26.3.0/ffdec_26.3.0.zip",
  sha256: "35f4930eb7c380afe66f2117f90b006deac0631473ad7500bb39c78f68645ecd",
  entry: "ffdec-cli.jar",
});

export function defaultCacheDir(env = process.env) {
  if (env.TFM_ASSETS_CACHE) return env.TFM_ASSETS_CACHE;
  if (env.XDG_CACHE_HOME) return path.join(env.XDG_CACHE_HOME, "tfm-map-renderer");
  return path.join(os.homedir(), ".cache", "tfm-map-renderer");
}

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

/**
 * Locate or install the pinned FFDec. Explicit `jar` (or TFM_FFDEC_JAR) always wins and is not
 * verified: the caller chose it. A downloaded archive is verified before anything is unpacked.
 */
export async function ensureFfdec({
  cacheDir = defaultCacheDir(), release = FFDEC_RELEASE, jar = process.env.TFM_FFDEC_JAR,
  fetchImpl = globalThis.fetch, log = () => {},
} = {}) {
  if (jar) {
    if (!(await exists(jar))) throw new Error(`FFDec jar not found: ${jar}`);
    return { jar, version: "custom", installed: false };
  }
  const dir = path.join(cacheDir, `ffdec-${release.version}`);
  const entry = path.join(dir, release.entry);
  const marker = path.join(dir, ".sha256");
  if (await exists(entry) && await exists(marker) && (await readFile(marker, "utf8")).trim() === release.sha256) {
    return { jar: entry, version: release.version, installed: false };
  }
  if (typeof fetchImpl !== "function") throw new Error("no fetch implementation available to download FFDec");
  log(`downloading FFDec ${release.version}`);
  const res = await fetchImpl(release.url);
  if (!res.ok) throw new Error(`FFDec download failed: HTTP ${res.status}`);
  const archive = Buffer.from(await res.arrayBuffer());
  const digest = sha256(archive);
  if (digest !== release.sha256) {
    throw new Error(`FFDec checksum mismatch: expected ${release.sha256}, got ${digest}; refusing to install`);
  }
  await mkdir(cacheDir, { recursive: true });
  const tmp = await mkdtemp(path.join(cacheDir, ".ffdec-tmp-"));
  try {
    for (const e of readZip(archive)) {
      const rel = safeEntryPath(e.name);
      if (!rel) continue;
      const target = path.join(tmp, rel);
      if (e.isDirectory) { await mkdir(target, { recursive: true }); continue; }
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, e.data(), { mode: e.mode & 0o111 ? 0o755 : 0o644 });
    }
    if (!(await exists(path.join(tmp, release.entry)))) throw new Error(`FFDec archive does not contain ${release.entry}`);
    await writeFile(path.join(tmp, ".sha256"), release.sha256 + "\n");
    await rm(dir, { recursive: true, force: true });
    await rename(tmp, dir);
  } catch (err) {
    await rm(tmp, { recursive: true, force: true });
    throw err;
  }
  return { jar: entry, version: release.version, installed: true };
}

function runProcess(execFileImpl, file, args, options) {
  return new Promise((resolve, reject) => {
    execFileImpl(file, args, options, (error, stdout, stderr) => {
      if (error) { error.stdout = stdout; error.stderr = stderr; reject(error); } else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/** @returns {Promise<{major:number,raw:string}>} */
export async function detectJava({ java = "java", execFileImpl = execFile } = {}) {
  let out;
  try { out = await runProcess(execFileImpl, java, ["-version"], { timeout: 15000 }); }
  catch (err) { throw new Error(`Java runtime not found (tried "${java}"). FFDec needs Java 8 or newer on PATH or --java.`, { cause: err }); }
  const text = `${out.stderr}\n${out.stdout}`;
  const m = /version "(\d+)(?:\.(\d+))?/.exec(text);
  if (!m) throw new Error(`could not parse Java version from: ${text.slice(0, 200)}`);
  const major = m[1] === "1" ? Number(m[2]) : Number(m[1]);
  return { major, raw: text.split("\n")[0].trim() };
}

/** Run ffdec-cli. FFDec reports some failures only via a "FAIL:" line, so stdout is checked too. */
export async function runFfdec({
  java = "java", jar, args, execFileImpl = execFile, timeoutMs = 30 * 60 * 1000, cwd,
}) {
  const full = ["-Djava.awt.headless=true", "-jar", jar, ...args];
  let out;
  try {
    out = await runProcess(execFileImpl, java, full, { timeout: timeoutMs, maxBuffer: 256 * 1024 * 1024, cwd });
  } catch (err) {
    const detail = String(err.stdout ?? "").split("\n").filter((l) => /FAIL|Exception|SEVERE/.test(l)).slice(0, 3).join(" | ");
    throw new Error(`ffdec failed (${err.code ?? err.signal ?? "error"}): ${detail || err.message}`, { cause: err });
  }
  const fail = /^FAIL:.*$/m.exec(out.stdout) ?? /^FAIL:.*$/m.exec(out.stderr);
  if (fail) {
    const npe = /NullPointerException.*$/m.exec(out.stdout + out.stderr);
    throw new Error(`ffdec reported failure: ${fail[0]}${npe ? ` (${npe[0]})` : ""}`);
  }
  return out;
}

/** Compress sorted ids into FFDec range syntax: 1,2,3,7 -> "1-3,7". */
export function idRanges(ids) {
  const sorted = [...new Set(ids)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    out.push(j > i ? `${sorted[i]}-${sorted[j]}` : String(sorted[i]));
    i = j + 1;
  }
  return out.join(",");
}

/**
 * Build `ffdec-cli` arguments for a static-asset export.
 * NOTE: FFDec 26.3.0 crashes on the documented `-select all:N` form (NullPointerException),
 * so first-frame selection is expressed per character: `-select <id>:1,<id>:1`.
 */
export function buildExportArgs({
  swfPath, outDir, types = ["shape", "sprite", "image"], selectIds = null, firstFrameIds = [], zoom = null,
  formats = "shape:svg,sprite:svg,image:png",
}) {
  const args = ["-format", formats, "-onerror", "ignore"];
  if (zoom) args.push("-zoom", String(zoom));
  if (selectIds?.length) args.push("-selectid", idRanges(selectIds));
  if (firstFrameIds.length) args.push("-select", firstFrameIds.map((id) => `${id}:1`).join(","));
  args.push("-export", types.join(","), outDir, swfPath);
  return args;
}

// --- Executable-based adapter (pre-existing): use an already-installed ffdec/ffdec.sh/ffdec-cli.exe ---
// Prefer ensureFfdec()/runFfdec() above for reproducible, version-pinned extraction.
const DEFAULT_CANDIDATES = process.platform === "win32"
  ? ["ffdec-cli.exe", "ffdec.bat", "ffdec"]
  : process.platform === "darwin"
    ? ["ffdec.sh", "ffdec"]
    : ["ffdec", "ffdec.sh"];

async function executableExists(command) {
  if (command.includes("/") || command.includes("\\")) {
    try { await access(command); return true; } catch { return false; }
  }
  const lookup = process.platform === "win32" ? "where" : "which";
  return await new Promise((resolvePromise) => {
    execFile(lookup, [command], (error) => resolvePromise(!error));
  });
}

export async function findFfdecExecutable(candidates = DEFAULT_CANDIDATES) {
  for (const candidate of candidates) {
    if (await executableExists(candidate)) return candidate;
  }
  return null;
}

/**
 * Run the documented JPEXS export command without invoking a shell.
 * Images retain FFDec's default PNG/JPEG output; shapes are requested as SVG.
 */
export function buildFfdecExportArgs({ input, outputDir, itemTypes = ["image", "shape"], shapeFormat = "svg" } = {}) {
  if (!input) throw new TypeError("FFDec input SWF is required");
  if (!outputDir) throw new TypeError("FFDec output directory is required");
  return ["-cli", "-format", `shape:${shapeFormat}`, "-export", itemTypes.join(","), resolve(outputDir), resolve(input)];
}

export async function exportFfdecAssets({ executable, input, outputDir, itemTypes = ["image", "shape"], shapeFormat = "svg", cwd } = {}) {
  if (!input) throw new TypeError("FFDec input SWF is required");
  if (!outputDir) throw new TypeError("FFDec output directory is required");
  const command = executable ?? await findFfdecExecutable();
  if (!command) throw new Error("FFDec executable not found; pass { executable } or install JPEXS FFDec");

  const out = resolve(outputDir);
  await mkdir(out, { recursive: true });
  const args = buildFfdecExportArgs({ input, outputDir: out, itemTypes, shapeFormat });
  const shell = process.platform === "win32" && /\.bat$/i.test(command);

  let stdout = "";
  let stderr = "";
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, shell, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) return resolvePromise();
      const error = new Error(`FFDec export failed with exit code ${code}`);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });
  });

  return { executable: command, input: resolve(input), outputDir: out, itemTypes, stdout, stderr };
}
