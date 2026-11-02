// The documentation: generated regions are up to date, relative links and anchors resolve, and every reference to the docs
// or the spec in the source code points at something that exists.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { generateDocs } from "../tools/gen-docs.mjs";
import { findAttribute } from "../src/tfm/spec/index.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP = new Set([".git", "node_modules", ".assets"]);
const toPosix = (p) => p.split(sep).join("/");

async function walk(dir, filter) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full, filter));
    else if (filter(entry.name)) out.push(full);
  }
  return out;
}

/** GitHub's heading slug: lower case, punctuation removed, spaces to hyphens; repeated slugs get -1, -2, ... */
function slugs(markdown) {
  const out = new Set();
  const seen = new Map();
  const text = markdown.replace(/```[\s\S]*?```/g, "");
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = m[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.add(n ? `${base}-${n}` : base);
  }
  for (const m of text.matchAll(/<a\s+(?:id|name)="([^"]+)"/g)) out.add(m[1]);
  return out;
}

const anchorCache = new Map();
async function anchorsOf(file) {
  if (!anchorCache.has(file)) anchorCache.set(file, slugs(await readFile(file, "utf8")));
  return anchorCache.get(file);
}

test("generated documentation is up to date (run: npm run docs:xml)", async () => {
  const { stale } = await generateDocs({ check: true });
  assert.deepEqual(stale.map((f) => toPosix(relative(ROOT, f))), []);
});

test("relative links and anchors in the documentation resolve", async () => {
  const problems = [];
  for (const file of await walk(ROOT, (n) => n.endsWith(".md"))) {
    const text = (await readFile(file, "utf8")).replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
    for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = m[1];
      if (/^[a-z]+:/i.test(target)) continue;
      const [path, anchor] = target.split("#");
      const resolved = path ? resolve(dirname(file), decodeURIComponent(path)) : file;
      const where = `${toPosix(relative(ROOT, file))}: ${target}`;
      if (!existsSync(resolved)) { problems.push(`${where} (missing file)`); continue; }
      if (anchor && resolved.endsWith(".md") && !(await anchorsOf(resolved)).has(anchor)) problems.push(`${where} (missing anchor)`);
    }
  }
  assert.deepEqual(problems, []);
});

/** `docs/<path>.md#anchor` and `spec: X.Y` references in the source. */
async function sourceReferences() {
  const refs = [];
  for (const file of await walk(join(ROOT, "src"), (n) => /\.(js|mjs)$/.test(n))) {
    const text = await readFile(file, "utf8");
    const at = toPosix(relative(ROOT, file));
    for (const m of text.matchAll(/\bdocs\/([\w./-]+\.md)(?:#([\w-]+))?/g)) refs.push({ at, kind: "doc", path: `docs/${m[1]}`, anchor: m[2] });
    for (const m of text.matchAll(/\bspec: ([\w/*]+\.[\w]+)/g)) refs.push({ at, kind: "spec", id: m[1] });
  }
  return refs;
}

test("doc and spec references in the source resolve", async () => {
  const problems = [];
  for (const ref of await sourceReferences()) {
    if (ref.kind === "spec") {
      if (!findAttribute(ref.id)) problems.push(`${ref.at}: spec: ${ref.id}`);
      continue;
    }
    const file = join(ROOT, ref.path);
    if (!existsSync(file)) problems.push(`${ref.at}: ${ref.path} (missing)`);
    else if (ref.anchor && !(await anchorsOf(file)).has(ref.anchor)) problems.push(`${ref.at}: ${ref.path}#${ref.anchor} (missing anchor)`);
  }
  assert.deepEqual(problems, []);
});

test("every public export has JSDoc for the API reference", async () => {
  const { apiEntries } = await import("../tools/gen-api.mjs");
  assert.deepEqual((await apiEntries()).filter((e) => !e.doc).map((e) => `${e.file}: ${e.name}`), []);
});

test("openapi.yaml lists every option the server accepts", async () => {
  const { ALLOWED_OPTIONS } = await import("../src/server/render-service.js");
  const yaml = await readFile(join(ROOT, "docs/api/openapi.yaml"), "utf8");
  const options = yaml.slice(yaml.indexOf("    RenderOptions:"), yaml.indexOf("    RenderResponse:"));
  assert.deepEqual(Object.keys(ALLOWED_OPTIONS).filter((name) => !new RegExp(`^        ${name}:`, "m").test(options)), []);
});
