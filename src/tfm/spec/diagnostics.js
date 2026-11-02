// Every diagnostic the XML layer or the map parser can attach to `map.source.diagnostics`. test/spec.test.js checks that
// this list and the codes the parsers emit are the same; docs/xml/values.md shows the table (tools/gen-docs.mjs).
//
// severity:
//   info          formatting; the game reads the map normally
//   client-quirk  the game reads the map, but not the way it looks
//   client-error  the game fails to load the map (it then loads default map 0)
//   editor-limit  the in-game editor would refuse to save this text; the game does not care

export const DIAGNOSTICS = Object.freeze([
  { code: "lenient-recovery", severity: "info", layer: "xml", meaning: "The parser (lenient by default; `lenient: false` is strict) recovered from markup a strict XML parser rejects, the way the game accepts it. `kind` is `stray-quotes` (`''` where an attribute name should start), `doubled-lt` (`<<`) or `garbled-tag-name` (a tag name containing `=`, quotes, `<` or `?`, read up to the next space, `/` or `>`).", game: "Real maps with these three faults run in the game; other malformed markup has not been tested." },
  { code: "duplicate-attribute", severity: "info", layer: "xml", meaning: "An element repeats an attribute name. The last value wins.", game: "Verified: the last value is used." },
  { code: "invalid-character-reference", severity: "info", layer: "xml", meaning: "`&#...;` with an out-of-range or malformed number; kept as text.", game: "Cannot occur in an editor-made map (`&` is not allowed)." },
  { code: "unknown-entity", severity: "info", layer: "xml", meaning: "`&name;` other than amp, lt, gt, quot, apos; kept as text.", game: "Cannot occur in an editor-made map (`&` is not allowed)." },
  { code: "multiple-root-elements", severity: "info", layer: "xml", meaning: "More than one top-level element; the first is the root.", game: "The first node is the map." },
  { code: "editor-disallowed-characters", severity: "editor-limit", layer: "text", meaning: "The text contains characters the editor does not allow; `characters` lists them. `$` only occurs in old maps and admin tools.", game: "None: the game reads any text; only the editor refuses to save it." },
  { code: "deprecated-attribute", severity: "info", layer: "semantic", meaning: "The settings carry `PNJ`, an attribute from 2012 that placed characters from the map. It no longer has an effect.", game: "Not read." },
  { code: "text-node-breaks-positional-slots", severity: "client-error", layer: "slots", meaning: "Text between tags (only a space is possible) takes a position, so the zone is not the second child of the root or has fewer than three children.", game: "The map fails to load. Spaces after the last container that matters are harmless." },
  { code: "legacy-text-node-shifts-root-slot", severity: "client-quirk", layer: "slots", meaning: "Text (usually formatting whitespace) sits among the first two children of the root.", game: "The game counts text as a child, so it would read the settings or the zone from the wrong element. `structureMode: \"client-raw\"` reproduces this." },
  { code: "legacy-text-node-shifts-zone-slot", severity: "client-quirk", layer: "slots", meaning: "Text sits among the first four children of the zone.", game: "The same shift for the ground, decoration, object and joint containers." },
  { code: "legacy-text-node-phantom-entries", severity: "client-quirk", layer: "slots", meaning: "A container (`S`, `D`, `O`, `L`) has text children.", game: "Each text node becomes an empty ground, decoration or object." },
  { code: "joint-unknown-tag-applies-to-previous", severity: "client-quirk", layer: "semantic", meaning: "A child of `L` is not `JD`, `JP`, `JPL` or `JR` but carries `c` and/or `lua`.", game: "The style or Lua id is applied to the previous joint; `joint.staleCarry.targetIndex` names it." },
  { code: "joint-lua-before-any-joint", severity: "client-error", layer: "semantic", meaning: "A child of `L` that is not a joint carries `lua` before any joint.", game: "The map fails to load." },
  { code: "zone-missing", severity: "client-error", layer: "structure", meaning: "The root has no second element.", game: "The map fails to load (it is not an empty map)." },
  { code: "zone-container-missing", severity: "client-error", layer: "structure", meaning: "The zone has fewer than three element children (the ground, decoration or object container is missing).", game: "The map fails to load." },
  { code: "decoration-p-attribute-missing", severity: "client-error", layer: "semantic", meaning: "A decoration `P` has no `P` attribute.", game: "The map fails to load." },
  { code: "particle-group-missing", severity: "client-error", layer: "semantic", meaning: "A particle `sp` or `acc` of two characters or more has no second `;` group.", game: "The map fails to load." },
  { code: "d-repeat-without-d-tuple", severity: "client-error", layer: "semantic", meaning: "`d` repeats an image but `D` has no `url,x,y,...` tuple (it is absent, `#...`, or a single URL).", game: "The map fails to load: the repeat offset comes from a `D` tuple that does not exist." },
]);
