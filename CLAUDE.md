# CLAUDE.md

Transformice map parser, SVG renderer, asset tools and PNG server. Node 20+, ES modules, no runtime dependencies (resvg is
optional, for the server).

## Layout

- `src/xml/` XML parser (source-preserving), `src/tfm/` map model (`parse-map.js`, `codecs.js`, `spec/` = every attribute as
  data), `src/render/` SVG renderer, `src/assets/` + `src/swf/` asset release build and loading, `src/server/` PNG server.
- `docs/xml/` map format reference, `docs/rendering.md` drawing rules and verification, `docs/api/` API docs,
  `docs/architecture.md` layers and design rules. Read the relevant page before changing behaviour.
- `test/` node:test suites; `test/maps/` reference maps with stored render hashes.

## Commands

- `npm test`: everything; must pass. No assets or network needed.
- `npm run docs:xml`: regenerate the generated regions (`<!-- BEGIN:x -->`) of `docs/xml/`, `docs/rendering.md`,
  `docs/api/parser.md` and `docs/xml/spec.json` after changing `src/tfm/spec/` or an export's JSDoc. Never edit inside the
  markers by hand.
- `UPDATE_RENDER_HASHES=1 npm test`: only after an intended change to the rendered picture.
- `npm run assets:build`, `npm run server`: real pictures and the PNG server (Java and network for the build).

## Rules

- Never add game code: none of the client's code in any form (recovered from the SWF or otherwise), no quotes from it, no obfuscated class or member names, no SWF
  files or extracted pictures. Describe behaviour in terms of the XML and what the game shows.
- The parser reports what the XML says; limits, mirroring, modes and gating are renderer options. Parsed data is never mutated.
  Unknown attributes and nodes are kept. No DOM in the parser; no network access in the parser or renderer.
- A behaviour change updates the spec entry (`src/tfm/spec/attributes.js`: rule, meaning, status, examples) and the prose of
  the matching `docs/xml/` page. Unverified behaviour is `status: "unverified"` with a note.
- Code that encodes a documented rule cites it: `// docs/xml/grounds.md#physics-p` or `// spec: S.P` (checked by
  `test/docs.test.js`).
- Events are options, not defaults. Keep requests to the game's servers to a handful.
- Match the surrounding code style; plain English in docs.
