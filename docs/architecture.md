# Architecture

```text
map XML --> XML parser (source-preserving AST) --> semantic map (what the XML says)
                                                        |
                                    renderTfmSvg(map, options, asset resolver)
                                                        |
                                SVG --> shared assets --> resvg --> PNG     (src/server, bin/tfm-render-server.mjs)

game SWFs --> unwrap --> FFDec --> bundles + effects.json = asset release --> resolver
```

The goal is fidelity: the picture should be what the game draws. SVG is the scene format (grounds are resized and tiled, which
needs vector pictures anyway) and resvg the rasteriser; there is no browser or canvas backend.

## Layers

| Directory | What | Depends on |
|---|---|---|
| `src/xml/` | XML parser and serializer: lenient by default, keeps every byte of the source (AST with offsets), exact attribute edits | nothing |
| `src/tfm/` | the map model: `parse-map.js` (XML to semantic map), `codecs.js` (the game's number conversions), `spec/` (every attribute as data, the source of `docs/xml/`), `client-constants.js` | `src/xml/` |
| `src/render/` | `renderTfmSvg` and its parts: ground textures, client limits, objects, shared assets | `src/tfm/`, a resolver |
| `src/assets/` | release build and loading, bundles, resolvers, FFDec adapter, image URL rules | `src/swf/`, Node |
| `src/swf/` | SWF reading: tags, display lists, the loader unwrap (a small AVM2 interpreter that runs the loader's own script) | nothing |
| `src/server/` | the PNG render service and its HTTP front end | everything above, `@resvg/resvg-js` |
| `src/util/` | Flash blur, PNG codec, screenshot comparison, archives | nothing |

Entry points: `tfm-map-renderer` (`src/index.js`, browser-safe: parser, renderer, URL rules), `tfm-map-renderer/node`
(assets, releases, FFDec; needs Node), `tfm-map-renderer/render`, `tfm-map-renderer/spec`, `tfm-map-renderer/assets/url-policy`.

## Design rules

- **The parser says what the XML says.** No clamping, list cuts, mirroring, map modes or feature gates in the parser; those
  are renderer options. Values the game derives at once go under `derived`, next to the raw value. Parsed data is never
  changed by a later step.
- **Nothing is dropped silently.** Unknown attributes and nodes are kept; malformed markup is recovered only in the cases real
  maps show, each with a diagnostic; a map the game would refuse still parses, with `clientLoads: false`.
- **Source is preserved.** The XML is not normalised; edits touch only the edited bytes; repeated attributes are addressed by
  exact entry.
- **No DOM in the parser**, so it runs in browsers and Node alike.
- **No uncontrolled network access.** The parser and renderer fetch nothing; external images only through a resolver that
  the caller configures.
- **Behaviour lives in one place.** Number conversions in `codecs.js`, attribute facts in `src/tfm/spec/`, image URLs in
  `src/assets/url-policy.js` and `image-urls.js`, client limits in `src/render/client-limits.js`. Code that encodes a rule
  cites where it is documented (`// docs/xml/grounds.md#physics-p`, `// spec: S.P`); a test checks those references resolve.
- **Events are options, not defaults.** The renderer draws the normal game.
- **Status is honest.** Every attribute in the spec is `verified`, `unverified` (with a note on what is guessed) or
  `extension`; the docs show it.

## Generated documentation

`npm run docs:xml` (`tools/gen-docs.mjs`) writes the tables of `docs/xml/`, `docs/rendering.md` and the function reference of
`docs/api/parser.md` from `src/tfm/spec/` and the JSDoc of the exports, plus `docs/xml/spec.json`. Prose outside the
`<!-- BEGIN:x -->` / `<!-- END:x -->` markers is hand-written. `npm test` fails when a generated region is stale, an example of
the spec does not parse to its value, or the spec and the parser disagree on the attributes.

## Performance

The parser is a dependency-free scanner: about 18 µs for a small map and about 1 ms for a 33 KB map of 700 elements
(`npm run bench:parser`, `bench:parser-large`). Building the SVG takes a few milliseconds; in the server, rasterising is nearly
all of the time ([`api/http.md`](api/http.md#performance)).
