// Builds the API reference from the JSDoc comments of the public exports of src/index.js.
// The API reference under docs/api/ embeds the result, so the reference cannot drift from the code.
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** [{ name, file }] for every `export { a, b } from "./x.js"` in src/index.js, in order. */
export async function publicExports() {
  const index = await readFile(new URL("src/index.js", root), "utf8");
  return [...index.matchAll(/export\s*\{([^}]*)\}\s*from\s*"\.\/([^"]+)"/g)].flatMap((m) =>
    m[1].split(",").map((s) => s.trim()).filter(Boolean).map((name) => ({ name, file: `src/${m[2]}` })));
}

function jsdocText(raw) {
  const lines = raw.replace(/^\/\*\*/, "").replace(/\*\/$/, "").split("\n").map((l) => l.replace(/^\s*\* ?/, ""));
  const out = [];
  let inExample = false;
  for (const l of lines) {
    if (/^@example/.test(l)) { inExample = true; out.push("", "```js"); continue; }
    out.push(l);
  }
  if (inExample) out.push("```");
  return out.map((l) => l.replace(/\s+$/, "")).join("\n").trim();
}

export async function apiEntries() {
  const entries = [];
  const cache = new Map();
  for (const { name, file } of await publicExports()) {
    if (!cache.has(file)) cache.set(file, await readFile(new URL(file, root), "utf8"));
    const text = cache.get(file);
    const m = new RegExp(`(/\\*\\*(?:(?!\\*/)[\\s\\S])*\\*/)?[ \\t]*\\n?^export\\s+((?:async\\s+)?(?:function|const|class)\\s+${escapeRe(name)}\\b[^\\n]*)`, "m").exec(text);
    if (!m) throw new Error(`${name} not found in ${file}`);
    entries.push({ name, file, doc: m[1] ? jsdocText(m[1]) : null, signature: /^(?:async\s+)?(?:function|class)\b/.test(m[2]) ? m[2].trim().replace(/\s*\{\s*$/, "") : m[2].trim().replace(/\s*=\s*.*$/, ""), });
  }
  return entries;
}

export async function renderApi() {
  const entries = await apiEntries();
  const byFile = new Map();
  for (const e of entries) byFile.set(e.file, [...(byFile.get(e.file) ?? []), e]);
  const out = [];
  for (const [file, list] of byFile) {
    out.push(`### \`${file}\`\n`);
    for (const e of list) out.push(`#### \`${e.name}\`\n\n\`${e.signature}\`\n\n${e.doc ?? "**UNDOCUMENTED**"}\n`);
  }
  return out.join("\n").trim();
}
