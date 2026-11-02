import { createHash } from "node:crypto";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

const MIME_TYPES = Object.freeze({
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
});

const SUPPORTED_EXTENSIONS = new Set(Object.keys(MIME_TYPES));

function posixRelative(rootDir, filePath) {
  return relative(rootDir, filePath).split(sep).join("/");
}

function readPngDimensions(bytes) {
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function readGifDimensions(bytes) {
  if (bytes.length < 10) return null;
  const signature = bytes.toString("ascii", 0, 6);
  if (signature !== "GIF87a" && signature !== "GIF89a") return null;
  return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
}

function readJpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset++; continue; }
    const marker = bytes[offset + 1];
    offset += 2;
    if (marker === 0xd8 || marker === 0xd9) continue;
    if (offset + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    const sof = marker >= 0xc0 && marker <= 0xc3 || marker >= 0xc5 && marker <= 0xc7 || marker >= 0xc9 && marker <= 0xcb || marker >= 0xcd && marker <= 0xcf;
    if (sof && length >= 7) {
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += length;
  }
  return null;
}

function readSvgDimensions(text) {
  const viewBox = text.match(/\bviewBox\s*=\s*["']\s*([^"']+?)\s*["']/i);
  if (viewBox) {
    const values = viewBox[1].trim().split(/[\s,]+/).map(Number);
    if (values.length === 4 && values.every(Number.isFinite)) {
      return { width: values[2], height: values[3], viewBox: values };
    }
  }
  const width = text.match(/\bwidth\s*=\s*["']\s*([0-9.]+)(?:px)?\s*["']/i);
  const height = text.match(/\bheight\s*=\s*["']\s*([0-9.]+)(?:px)?\s*["']/i);
  if (width && height) return { width: Number(width[1]), height: Number(height[1]) };
  return null;
}

function dimensionsFor(extension, bytes, text) {
  if (extension === ".png") return readPngDimensions(bytes);
  if (extension === ".gif") return readGifDimensions(bytes);
  if (extension === ".jpg" || extension === ".jpeg") return readJpegDimensions(bytes);
  if (extension === ".svg") return readSvgDimensions(text);
  return null;
}

async function walkFiles(rootDir, currentDir = rootDir, out = []) {
  const entries = await readdir(currentDir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const path = resolve(currentDir, entry.name);
    if (entry.isDirectory()) await walkFiles(rootDir, path, out);
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

export async function scanAssetDirectory(rootDir, options = {}) {
  const absoluteRoot = resolve(rootDir);
  const include = options.include ?? ((path) => SUPPORTED_EXTENSIONS.has(extname(path).toLowerCase()));
  const files = (await walkFiles(absoluteRoot)).filter(include);
  const assets = [];

  for (const filePath of files) {
    const bytes = await readFile(filePath);
    const extension = extname(filePath).toLowerCase();
    const relativePath = posixRelative(absoluteRoot, filePath);
    const text = extension === ".svg" ? bytes.toString("utf8") : null;
    assets.push({
      path: relativePath,
      mime: MIME_TYPES[extension] ?? "application/octet-stream",
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      aliases: [],
      dimensions: dimensionsFor(extension, bytes, text),
    });
  }

  return {
    format: "tfm-asset-manifest",
    version: 1,
    generatedBy: "tfm-map-renderer",
    assets,
  };
}

export async function writeAssetManifest(manifest, outputPath) {
  const json = JSON.stringify(manifest, null, 2) + "\n";
  await writeFile(outputPath, json, "utf8");
  return manifest;
}
