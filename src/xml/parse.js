const DEFAULT_OPTIONS = Object.freeze({
  preserveComments: true,
  preserveWhitespaceText: true,
  preserveProcessingInstructions: true,
  preserveCdata: true,
  allowDoctype: false,
  allowUnquotedAttributes: false,
  unknownEntity: "preserve",
  lenient: true,
});

/**
 * Thrown by `parseXml` for malformed XML. Carries the source offset of the problem.
 */
export class XmlSyntaxError extends SyntaxError {
  constructor(message, offset, source) {
    const { line, column } = locate(source, offset);
    super(`${message} at ${line}:${column}`);
    this.name = "XmlSyntaxError";
    this.offset = offset;
    this.line = line;
    this.column = column;
  }
}

function locate(source, offset) {
  let line = 1;
  let lastBreak = -1;
  for (let i = 0; i < offset; i++) {
    if (source.charCodeAt(i) === 10) {
      line++;
      lastBreak = i;
    }
  }
  return { line, column: offset - lastBreak };
}

function isSpaceCode(code) {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
}

function skipSpace(source, i) {
  while (i < source.length && isSpaceCode(source.charCodeAt(i))) i++;
  return i;
}

function readName(source, i) {
  const start = i;
  while (i < source.length) {
    const c = source.charCodeAt(i);
    if (
      isSpaceCode(c) || c === 0x2f || c === 0x3e || c === 0x3d ||
      c === 0x3c || c === 0x22 || c === 0x27 || c === 0x3f
    ) break;
    i++;
  }
  return { value: source.slice(start, i), end: i };
}

function readLenientName(source, i, diagnostics) {
  const start = i;
  while (i < source.length) {
    const c = source.charCodeAt(i);
    if (isSpaceCode(c) || c === 0x2f || c === 0x3e) break;
    i++;
  }
  const value = source.slice(start, i);
  if (/[="'<?]/.test(value)) diagnostics.push({ code: "lenient-recovery", kind: "garbled-tag-name", offset: start, name: value });
  return { value, end: i };
}

function decodeEntities(value, options, diagnostics, baseOffset, source) {
  if (!value.includes("&")) return value;
  return value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_:][\w:.-]*);/g, (full, body, index) => {
    if (body[0] === "#") {
      const hex = body[1]?.toLowerCase() === "x";
      const number = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(number) || number < 0 || number > 0x10ffff) {
        diagnostics.push({ code: "invalid-character-reference", offset: baseOffset + index, value: full });
        return options.unknownEntity === "error"
          ? (() => { throw new XmlSyntaxError(`Invalid character reference ${full}`, baseOffset + index, source); })()
          : full;
      }
      try { return String.fromCodePoint(number); } catch { return full; }
    }
    switch (body) {
      case "amp": return "&";
      case "lt": return "<";
      case "gt": return ">";
      case "quot": return '"';
      case "apos": return "'";
      default:
        diagnostics.push({ code: "unknown-entity", offset: baseOffset + index, value: full });
        if (options.unknownEntity === "error") {
          throw new XmlSyntaxError(`Unknown entity ${full}`, baseOffset + index, source);
        }
        return full;
    }
  });
}

function makeDocument(source) {
  const document = {
    kind: "document",
    source,
    children: [],
    root: null,
    diagnostics: [],
  };
  Object.defineProperty(document, "_sourceEdits", { value: [], writable: true, enumerable: false });
  Object.defineProperty(document, "_nextEditSequence", { value: 1, writable: true, enumerable: false });
  Object.defineProperty(document, "_nodeIndexCache", { value: null, writable: true, enumerable: false });
  return document;
}

/**
 * Pure-JS, non-DOM XML parser intended for Transformice source preservation.
 * It accepts ordinary XML plus duplicate attributes (preserved + diagnosed).
 * Client-specific malformed-markup recovery is intentionally not guessed: by default (`lenient: false` makes it strict) the three cases seen in real maps
 * (docs/xml/values.md#malformed-xml-the-game-accepts) are recovered, each with a `lenient-recovery` diagnostic.
 */
export function parseXml(source, userOptions = {}) {
  if (typeof source !== "string") throw new TypeError("XML source must be a string");
  const options = { ...DEFAULT_OPTIONS, ...userOptions };
  const document = makeDocument(source);
  const stack = [document];
  let id = 0;
  let i = source.charCodeAt(0) === 0xfeff ? 1 : 0;

  const add = (node) => {
    const parent = stack[stack.length - 1];
    parent.children.push(node);
    if (node.kind === "element" && parent.kind === "document") {
      if (!document.root) document.root = node;
      else document.diagnostics.push({ code: "multiple-root-elements", offset: node.start, name: node.name });
    }
  };

  while (i < source.length) {
    if (source[i] !== "<") {
      const start = i;
      const next = source.indexOf("<", i);
      i = next === -1 ? source.length : next;
      const raw = source.slice(start, i);
      if (raw && (options.preserveWhitespaceText || raw.trim())) {
        add({
          id: ++id,
          kind: "text",
          value: decodeEntities(raw, options, document.diagnostics, start, source),
          raw,
          start,
          end: i,
        });
      }
      continue;
    }

    if (source.startsWith("<!--", i)) {
      const start = i;
      const endMarker = source.indexOf("-->", i + 4);
      if (endMarker === -1) throw new XmlSyntaxError("Unterminated comment", i, source);
      const end = endMarker + 3;
      if (options.preserveComments) {
        add({ id: ++id, kind: "comment", value: source.slice(i + 4, endMarker), raw: source.slice(start, end), start, end });
      }
      i = end;
      continue;
    }

    if (source.startsWith("<![CDATA[", i)) {
      const start = i;
      const endMarker = source.indexOf("]]>", i + 9);
      if (endMarker === -1) throw new XmlSyntaxError("Unterminated CDATA", i, source);
      const end = endMarker + 3;
      if (options.preserveCdata) {
        add({ id: ++id, kind: "cdata", value: source.slice(i + 9, endMarker), raw: source.slice(start, end), start, end });
      } else {
        add({ id: ++id, kind: "text", value: source.slice(i + 9, endMarker), raw: source.slice(start, end), start, end });
      }
      i = end;
      continue;
    }

    if (/^<!DOCTYPE\b/i.test(source.slice(i, i + 10))) {
      if (!options.allowDoctype) throw new XmlSyntaxError("DOCTYPE is disabled", i, source);
      const start = i;
      let depth = 0;
      let quote = null;
      i += 9;
      while (i < source.length) {
        const ch = source[i];
        if (quote) {
          if (ch === quote) quote = null;
        } else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === "[") depth++;
        else if (ch === "]") depth = Math.max(0, depth - 1);
        else if (ch === ">" && depth === 0) { i++; break; }
        i++;
      }
      if (i > source.length || source[i - 1] !== ">") throw new XmlSyntaxError("Unterminated DOCTYPE", start, source);
      add({ id: ++id, kind: "doctype", raw: source.slice(start, i), start, end: i });
      continue;
    }

    if (source.startsWith("<?", i)) {
      const start = i;
      const endMarker = source.indexOf("?>", i + 2);
      if (endMarker === -1) throw new XmlSyntaxError("Unterminated processing instruction", i, source);
      const body = source.slice(i + 2, endMarker).trim();
      const split = body.search(/\s/);
      const target = split === -1 ? body : body.slice(0, split);
      const value = split === -1 ? "" : body.slice(split).trim();
      const end = endMarker + 2;
      if (options.preserveProcessingInstructions) {
        add({ id: ++id, kind: "pi", target, value, raw: source.slice(start, end), start, end });
      }
      i = end;
      continue;
    }

    if (source.startsWith("</", i)) {
      const start = i;
      i = skipSpace(source, i + 2);
      const nameRead = readName(source, i);
      const name = nameRead.value;
      if (!name) throw new XmlSyntaxError("Missing closing tag name", i, source);
      i = skipSpace(source, nameRead.end);
      if (source[i] !== ">") throw new XmlSyntaxError("Expected > after closing tag", i, source);
      i++;
      if (stack.length === 1) throw new XmlSyntaxError(`Unexpected closing tag </${name}>`, start, source);
      const open = stack[stack.length - 1];
      if (open.name !== name) {
        throw new XmlSyntaxError(`Mismatched closing tag </${name}> for <${open.name}>`, start, source);
      }
      open.closeStart = start;
      open.end = i;
      stack.pop();
      continue;
    }

    if (source.startsWith("<!", i)) {
      throw new XmlSyntaxError("Unsupported declaration", i, source);
    }

    // Element
    const start = i;
    i++;
    // Lenient (map 4220115, `<<L />`): the legacy parser runs a doubled `<` together with the tag after it.
    if (options.lenient && source[i] === "<") {
      document.diagnostics.push({ code: "lenient-recovery", kind: "doubled-lt", offset: i });
      i++;
    }
    // Lenient (map 7974343, `<Jaaf43f,10,0.4" P1=...`): a garbled tag name runs up to the next space, `/` or `>`.
    const nameRead = options.lenient ? readLenientName(source, i, document.diagnostics) : readName(source, i);
    const name = nameRead.value;
    if (!name) throw new XmlSyntaxError("Missing element name", i, source);
    i = nameRead.end;
    const attributes = [];
    const seen = new Map();
    let selfClosing = false;

    while (i < source.length) {
      i = skipSpace(source, i);
      if (source.startsWith("/>", i)) {
        selfClosing = true;
        i += 2;
        break;
      }
      if (source[i] === ">") {
        i++;
        break;
      }
      if (i >= source.length) throw new XmlSyntaxError(`Unterminated start tag <${name}>`, start, source);

      // Lenient (maps 3618931 and 7180959, `a="1" \'\'F="1"`): a stray pair of quotes where an attribute name should start is skipped.
      if (options.lenient && (source.startsWith("''", i) || source.startsWith('""', i))) {
        document.diagnostics.push({ code: "lenient-recovery", kind: "stray-quotes", offset: i });
        i += 2;
        continue;
      }
      const attrStart = i;
      const attrNameRead = readName(source, i);
      const attrName = attrNameRead.value;
      if (!attrName) throw new XmlSyntaxError("Missing attribute name", i, source);
      i = skipSpace(source, attrNameRead.end);
      if (source[i] !== "=") throw new XmlSyntaxError(`Expected = after attribute ${attrName}`, i, source);
      i = skipSpace(source, i + 1);

      let quote = source[i];
      let rawValue;
      let valueStart;
      if (quote === '"' || quote === "'") {
        valueStart = ++i;
        const endQuote = source.indexOf(quote, i);
        if (endQuote === -1) throw new XmlSyntaxError(`Unterminated attribute ${attrName}`, attrStart, source);
        rawValue = source.slice(i, endQuote);
        i = endQuote + 1;
      } else if (options.allowUnquotedAttributes) {
        quote = null;
        valueStart = i;
        while (i < source.length && !isSpaceCode(source.charCodeAt(i)) && source[i] !== ">" && !source.startsWith("/>", i)) i++;
        rawValue = source.slice(valueStart, i);
      } else {
        throw new XmlSyntaxError(`Expected quoted value for attribute ${attrName}`, i, source);
      }

      const attr = {
        name: attrName,
        value: decodeEntities(rawValue, options, document.diagnostics, valueStart, source),
        rawValue,
        quote,
        start: attrStart,
        end: i,
        valueStart,
        valueEnd: valueStart + rawValue.length,
      };
      attributes.push(attr);
      if (seen.has(attrName)) {
        document.diagnostics.push({ code: "duplicate-attribute", offset: attrStart, name: attrName });
      }
      seen.set(attrName, attr);
    }

    const element = {
      id: ++id,
      kind: "element",
      name,
      attributes,
      children: [],
      selfClosing,
      start,
      openEnd: i,
      end: selfClosing ? i : null,
    };
    add(element);
    if (!selfClosing) stack.push(element);
  }

  if (stack.length !== 1) {
    const open = stack[stack.length - 1];
    throw new XmlSyntaxError(`Unclosed element <${open.name}>`, open.start, source);
  }
  if (!document.root) throw new XmlSyntaxError("No root element", 0, source);
  return document;
}

/**
 * Element children of a node, in source order (text, comments and CDATA are skipped).
 */
export function elementChildren(node) {
  return node?.children?.filter((child) => child.kind === "element") ?? [];
}

/**
 * All attribute occurrences of `node` (every occurrence of `name` when given, in source order). Duplicates are kept: the client's lookup is last-wins, but Lua tooling may repeat attributes on purpose.
 */
export function attributeEntries(node, name) {
  const entries = node?.attributes ?? [];
  if (name === undefined) return entries;
  return entries.filter((attribute) => attribute.name === name);
}

function ensureNodeIndex(document) {
  assertEditableDocument(document);
  if (document._nodeIndexCache instanceof Map) return document._nodeIndexCache;
  const index = new Map();
  const visit = (node) => {
    if (Number.isInteger(node?.id)) index.set(node.id, node);
    for (const child of node?.children ?? []) visit(child);
  };
  for (const child of document.children) visit(child);
  document._nodeIndexCache = index;
  return index;
}

/**
 * Resolve a `source.nodeId` found in the parsed map back to its AST node of `document`, for editing.
 */
export function getXmlNodeById(document, nodeId) {
  return ensureNodeIndex(document).get(nodeId) ?? null;
}

/**
 * Attribute name -> value of a node, last occurrence winning (the client's lookup rule).
 */
export function attributeMap(node) {
  const result = Object.create(null);
  for (const attr of node?.attributes ?? []) result[attr.name] = attr.value;
  return result;
}

/**
 * Value of attribute `name` on `node` (last occurrence), or `undefined`.
 */
export function getAttribute(node, name) {
  let value;
  for (const attr of node?.attributes ?? []) if (attr.name === name) value = attr.value;
  return value;
}

/**
 * Whether `node` carries attribute `name` at all (`attr=""` counts: the client tests `!= null`).
 */
export function hasAttribute(node, name) {
  for (const attr of node?.attributes ?? []) if (attr.name === name) return true;
  return false;
}

function assertEditableDocument(document) {
  if (!document || document.kind !== "document" || typeof document.source !== "string" || !Array.isArray(document._sourceEdits)) {
    throw new TypeError("Expected a parsed XML document");
  }
}

function assertElement(node) {
  if (!node || node.kind !== "element" || !Array.isArray(node.attributes)) {
    throw new TypeError("Expected an XML element node");
  }
}

function assertAttribute(attribute) {
  if (!attribute || typeof attribute.name !== "string") throw new TypeError("Expected an XML attribute entry");
}

function findElement(document, target) {
  const visit = (node) => {
    if (node === target) return node;
    for (const child of node?.children ?? []) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  for (const child of document.children) {
    const found = visit(child);
    if (found) return found;
  }
  return null;
}

function findAttributeOwner(document, target) {
  const visit = (node) => {
    if (node?.kind === "element" && node.attributes.includes(target)) return node;
    for (const child of node?.children ?? []) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  for (const child of document.children) {
    const found = visit(child);
    if (found) return found;
  }
  return null;
}

function upsertSourceEdit(document, target, kind, start, end, text) {
  const existing = document._sourceEdits.find((edit) => edit.target === target && edit.kind === kind);
  if (existing) {
    existing.start = start;
    existing.end = end;
    existing.text = text;
    return existing;
  }
  const edit = { target, kind, start, end, text, sequence: document._nextEditSequence++ };
  document._sourceEdits.push(edit);
  return edit;
}

function removeSourceEdit(document, target, kind) {
  document._sourceEdits = document._sourceEdits.filter((edit) => edit.target !== target || edit.kind !== kind);
}

function removeSourceEdits(document, target) {
  document._sourceEdits = document._sourceEdits.filter((edit) => edit.target !== target);
}

function sourceInsertionOffset(document, node) {
  let offset = node.selfClosing ? node.openEnd - 2 : node.openEnd - 1;
  const lowerBound = node.start + 1 + node.name.length;
  while (offset > lowerBound && isSpaceCode(document.source.charCodeAt(offset - 1))) offset--;
  return offset;
}

function serializeInsertedAttribute(attribute) {
  const quote = attribute.quote || '"';
  return ` ${attribute.name}=${quote}${escapeAttr(String(attribute.value), quote)}${quote}`;
}

function escapeUnquotedAttr(value) {
  return escapeText(value)
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll(" ", "&#32;")
    .replaceAll("\t", "&#9;")
    .replaceAll("\n", "&#10;")
    .replaceAll("\r", "&#13;");
}

/**
 * Change one exact attribute entry. This is duplicate-attribute safe because callers
 * pass the entry object returned by attributeEntries(node), not only its name; the client's lookup is
 * last-wins, but custom/Lua tooling may repeat attributes on purpose, so mutation is occurrence-explicit.
 *
 * The original quote style (or unquoted form) is kept when possible and the new value is entity-escaped.
 * Setting the decoded value it already has is a byte-preserving no-op, and reverting an edit restores the original raw
 * entity spelling. An entry that belongs to another document is rejected.
 *
 * @example
 * const { map, document } = parseTfmDocument(`<C><P L='800' custom="a"/><Z><S/><D/><O/></Z></C>`);
 * const settings = getXmlNodeById(document, map.settings.source.nodeId);
 * const width = attributeEntries(settings, "L")[0];
 * setXmlAttributeValue(document, width, "900");
 * const added = appendXmlAttribute(document, settings, "H", "400");
 * removeXmlAttribute(document, added);
 * serializeXml(document, { mode: "preserve" });
 * // <C><P L='900' custom="a"/><Z><S/><D/><O/></Z></C>
 */
export function setXmlAttributeValue(document, attribute, value) {
  assertEditableDocument(document);
  assertAttribute(attribute);
  if (!findAttributeOwner(document, attribute)) throw new Error("Attribute belongs to a different XML document");
  if (attribute._removed) throw new Error(`Cannot edit removed attribute ${attribute.name}`);
  const nextValue = String(value);
  if (nextValue === attribute.value) return attribute;

  if (attribute._inserted) {
    attribute.value = nextValue;
    attribute.rawValue = nextValue;
    const edit = document._sourceEdits.find((candidate) => candidate.target === attribute && candidate.kind === "insert-attribute");
    if (!edit) throw new Error("Inserted attribute lost its source edit");
    edit.text = serializeInsertedAttribute(attribute);
    return attribute;
  }

  if (!Number.isInteger(attribute.valueStart) || !Number.isInteger(attribute.valueEnd)) {
    throw new Error("Attribute has no editable source range");
  }
  if (!("_originalValue" in attribute)) {
    Object.defineProperty(attribute, "_originalValue", { value: attribute.value, enumerable: false });
    Object.defineProperty(attribute, "_originalRawValue", { value: attribute.rawValue, enumerable: false });
  }
  attribute.value = nextValue;
  if (nextValue === attribute._originalValue) {
    attribute.rawValue = attribute._originalRawValue;
    removeSourceEdit(document, attribute, "attribute-value");
    return attribute;
  }

  const encoded = attribute.quote == null
    ? escapeUnquotedAttr(attribute.value)
    : escapeAttr(attribute.value, attribute.quote);
  attribute.rawValue = encoded;
  upsertSourceEdit(document, attribute, "attribute-value", attribute.valueStart, attribute.valueEnd, encoded);
  return attribute;
}

/** Append an attribute without rewriting the rest of the start tag: it is inserted before the original closing-tag whitespace. */
export function appendXmlAttribute(document, node, name, value, { quote = '"' } = {}) {
  assertEditableDocument(document);
  assertElement(node);
  if (!findElement(document, node)) throw new Error("Element belongs to a different XML document");
  if (typeof name !== "string" || !name || readName(name, 0).end !== name.length) {
    throw new TypeError("Attribute name is not accepted by this XML parser");
  }
  if (quote !== '"' && quote !== "'") throw new TypeError("Attribute quote must be single or double quote");
  const attribute = {
    name,
    value: String(value),
    rawValue: String(value),
    quote,
    start: null,
    end: null,
    valueStart: null,
    valueEnd: null,
    _inserted: true,
  };
  node.attributes.push(attribute);
  const offset = sourceInsertionOffset(document, node);
  upsertSourceEdit(document, attribute, "insert-attribute", offset, offset, serializeInsertedAttribute(attribute));
  return attribute;
}

/** Remove one exact attribute entry (and only that one) without choosing among duplicates by name. */
export function removeXmlAttribute(document, attribute) {
  assertEditableDocument(document);
  assertAttribute(attribute);
  const node = findAttributeOwner(document, attribute);
  if (!node) throw new Error("Attribute belongs to a different XML document or is no longer attached");
  const index = node.attributes.indexOf(attribute);
  node.attributes.splice(index, 1);

  if (attribute._inserted) {
    removeSourceEdits(document, attribute);
  } else {
    removeSourceEdits(document, attribute);
    if (!Number.isInteger(attribute.start) || !Number.isInteger(attribute.end)) {
      throw new Error("Attribute has no removable source range");
    }
    upsertSourceEdit(document, attribute, "remove-attribute", attribute.start, attribute.end, "");
  }
  attribute._removed = true;
  return attribute;
}

function escapeText(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function escapeAttr(value, quote) {
  let out = escapeText(value);
  return quote === "'" ? out.replaceAll("'", "&apos;") : out.replaceAll('"', "&quot;");
}

function serializeNode(node) {
  switch (node.kind) {
    case "text": return escapeText(node.value);
    case "cdata": return `<![CDATA[${node.value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
    case "comment": return `<!--${node.value}-->`;
    case "pi": return `<?${node.target}${node.value ? ` ${node.value}` : ""}?>`;
    case "doctype": return node.raw ?? "";
    case "element": {
      const attrs = node.attributes.map((a) => {
        const quote = a.quote || '"';
        return ` ${a.name}=${quote}${escapeAttr(a.value, quote)}${quote}`;
      }).join("");
      if (node.selfClosing && node.children.length === 0) return `<${node.name}${attrs}/>`;
      return `<${node.name}${attrs}>${node.children.map(serializeNode).join("")}</${node.name}>`;
    }
    default: throw new TypeError(`Unknown XML node kind: ${node.kind}`);
  }
}

function serializePreservedSource(document) {
  if (!document._sourceEdits?.length) return document.source;
  const edits = [...document._sourceEdits].sort((a, b) => a.start - b.start || a.sequence - b.sequence);
  let cursor = 0;
  let out = "";
  for (const edit of edits) {
    if (edit.start < cursor) throw new Error("Overlapping XML source edits are not supported");
    if (edit.end < edit.start || edit.end > document.source.length) throw new Error("Invalid XML source edit range");
    out += document.source.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return out + document.source.slice(cursor);
}

/**
 * Serialize a parsed document. `mode: "preserve"` (default) returns the original bytes, with exact attribute edits applied surgically so unrelated spacing, quoting and order survive; `mode: "canonical"` writes a normalised form.
 *
 * @example
 * const { map, document } = parseTfmDocument(xml);
 * serializeXml(document, { mode: "preserve" });
 */
export function serializeXml(document, { mode = "preserve" } = {}) {
  if (mode === "preserve" && typeof document.source === "string") return serializePreservedSource(document);
  if (mode !== "canonical") throw new TypeError(`Unknown serialization mode: ${mode}`);
  return document.children.map(serializeNode).join("");
}
