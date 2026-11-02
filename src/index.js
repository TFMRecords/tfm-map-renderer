export {
  parseXml,
  serializeXml,
  XmlSyntaxError,
  elementChildren,
  attributeEntries,
  getXmlNodeById,
  attributeMap,
  getAttribute,
  hasAttribute,
  setXmlAttributeValue,
  appendXmlAttribute,
  removeXmlAttribute,
} from "./xml/parse.js";
export { findEditorViolations, EDITOR_ALLOWED } from "./tfm/editor-limits.js";
export { parseTfmMap, parseTfmDocument, legacyChildNodes, KNOWN_ATTRIBUTES } from "./tfm/parse-map.js";
export { as3Number, as3NumberOrZero, as3Int, as3ParseFloat, as3ParseInt, as3Truthy } from "./tfm/codecs.js";

export { renderTfmSvg, DEFAULT_LIMITS } from "./render/svg.js";
export { CLIENT_LIMIT_PRESETS, resolveClientLimits, applyClientLimits } from "./render/client-limits.js";
export { IMAGE_BASES, isAtelier801BareImageName, resolveTfmImageUrl, classifyImageReference } from "./assets/url-policy.js";
export { resolveClientImageUrl, isOfficialHost, OFFICIAL_HOSTS } from "./assets/image-urls.js";
export { OBJECT_FILTER, decodeObjectType, groundConstructorPhysics, normalizeGroundPhysics, decodeCollisionGroup } from "./tfm/client-constants.js";
