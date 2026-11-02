// The map editor refuses to save XML that contains any character outside this set (docs/xml/limits-and-modes.md#the-editor).
// It was found by testing many symbols and letters from other alphabets in the editor (for example e-acute, c-cedilla, i-dotless, s-cedilla, g-breve, u-umlaut) to derive it, and
// all 72 archived real maps obey it except two staff-made event maps that carry a deprecated `PNJ` attribute using `$`:
//
//   a-z  A-Z  0-9  space (only the space: no tab, no newline)  and  < > " ' - _ . , : ; = / #
//
// `$` is not allowed for users: only admin tools and old existing maps contain it.
//
// Consequences, all of which follow from the list:
//   - no comments, CDATA, DOCTYPE or XML declaration (`!` and `?` are not allowed), and no processing instructions
//   - no entities or character references (`&` is not allowed), so attribute text is always literal
//   - no newlines or tabs, so editor XML is a single line; only spaces can appear between tags
//   - `#` IS allowed, so tiled `D="#url,w,h"` backgrounds and hex particle ids (`id="#ff00aa"`) can be created
//   - absolute URLs are expressible (`:`, `/`, `.`, `-`, `_`, `#` are allowed) but never with a query string
//     (`?`, `&`, `%` and `+` are not)
//
// This module only reports; the parser never rejects a map because of it.

/**
 * Pattern of the only characters the map editor saves: `a-z A-Z 0-9`, the space, and `< > " ' - _ . , : ; = / #`.
 */
export const EDITOR_ALLOWED = /^[A-Za-z0-9 <>"'\-_.,:;=/#]*$/;
const DISALLOWED = /[^A-Za-z0-9 <>"'\-_.,:;=/#]/g;

const REASONS = new Map([
  ["\n", "newline: the editor allows only the space character as whitespace"],
  ["\r", "carriage return: the editor allows only the space character as whitespace"],
  ["\t", "tab: the editor allows only the space character as whitespace"],
  ["!", "comments, CDATA and DOCTYPE cannot be written"],
  ["?", "XML declarations, processing instructions and URL query strings cannot be written"],
  ["&", "entities and character references cannot be written"],
  ["$", "reserved: only admin tools and old existing maps contain it (the deprecated PNJ attribute does)"],
]);

/**
 * @param {string} xml
 * @returns {{ok:boolean,count:number,characters:Array<{char:string,codepoint:number,count:number,firstOffset:number,reason:string}>}}
 */
export function findEditorViolations(xml) {
  const text = String(xml ?? "");
  if (EDITOR_ALLOWED.test(text)) return { ok: true, count: 0, characters: [] };
  const seen = new Map();
  let count = 0;
  for (const m of text.matchAll(DISALLOWED)) {
    count++;
    const entry = seen.get(m[0]) ?? {
      char: m[0], codepoint: m[0].codePointAt(0), count: 0, firstOffset: m.index,
      reason: REASONS.get(m[0]) ?? (m[0].charCodeAt(0) > 127 ? "non-ASCII characters are not allowed" : "this punctuation is not in the editor's allowed set"),
    };
    entry.count++;
    seen.set(m[0], entry);
  }
  return { ok: false, count, characters: [...seen.values()] };
}
