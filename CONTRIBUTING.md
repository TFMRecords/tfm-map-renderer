# Contributing

Thanks for helping. Issues and pull requests are welcome: a map that renders differently from the game is the most useful
report there is (attach the XML and a screenshot from the game).

## Ground rules

- **No game code and no game files.** Do not contribute the game client's code in any form (recovered from its SWF files or
  otherwise), quotes from it, names of its obfuscated classes or members, or the game's SWF files and extracted pictures.
  Describe behaviour in terms of the XML and of what the game shows. The pictures are built by each user from the game's own files (`npm run assets:build`).
- **No other people's maps without permission.** Test maps in this repository are written for one question each.
- **The game decides.** Where the game, the in-game editor, third-party editors and community documentation disagree, the
  game wins; note the disagreement in the docs. Something not checked in the game is marked `unverified` in the spec with a
  note saying what is guessed.
- **Events are options, not defaults.** The renderer draws the normal game; event looks go behind an option.
- **Be gentle with the game's servers.** A handful of requests, never a scan.

## Setup

```sh
npm install
npm test                 # all tests; no assets, Java or network needed
npm run assets:build     # optional: the game's pictures, for real renders (Java, network)
```

Node 20 or newer. Some tests are skipped unless you set `TFM_FFDEC_JAR` (a real `ffdec-cli.jar`, Java installed) or
`TFM_LOADER_SWF` (a downloaded `Transformice.swf`).

## Layout

[`docs/architecture.md`](docs/architecture.md) explains the layers and the design rules. In short: the parser
(`src/tfm/parse-map.js`) reports what the XML says, the renderer (`src/render/svg.js`) decides what the game shows, and every
attribute is described as data in `src/tfm/spec/`.

## Changing what an attribute does

1. Change the parser, and the entry in `src/tfm/spec/attributes.js`: the rule in plain language (name the conversions of
   [`docs/xml/values.md`](docs/xml/values.md)), the meaning, the status, and examples (each is run as a test).
2. `npm run docs:xml` regenerates the tables in `docs/xml/`, `docs/rendering.md`, `docs/api/parser.md` and
   `docs/xml/spec.json`. Edit the prose around the tables by hand when needed.
3. In code, cite where a rule is documented: `// docs/xml/grounds.md#physics-p` or `// spec: S.P`. The docs test checks that
   every such reference resolves.
4. `npm test`. It fails when generated docs are stale, an example does not parse to its value, or the spec and the parser
   disagree.

## Changing the picture

`test/render.test.js` stores a hash of the SVG of every map in `test/maps/` with five option sets. When a change is meant to
alter the picture, run `UPDATE_RENDER_HASHES=1 npm test` and say in the pull request which maps changed and why (ideally with a
comparison against the game, below).

## Checking against the game

Reference maps are small and answer one question each: 800 x 400, gravity 0 (`G="0,0"`), nothing in the area of the 3-2-1
countdown digit (x about 340 to 470 at the top). To compare:

1. Load ONE map in the game in a `#Module` room (so no limits apply), and in the in-game editor if the editor matters.
2. Take a screenshot of the game area.
3. `npm run compare -- --xml MAP.xml --shot SHOT.png --release .assets/release [--mirror] --out DIR`
   ([`docs/api/renderer.md`](docs/api/renderer.md#comparing-with-a-game-screenshot)). It aligns the render with the screenshot
   and prints the error per element; `DIR/diff.png` shows where they differ.

Add a row to the "What is verified" table of [`docs/rendering.md`](docs/rendering.md) and change the status in the spec when a
check settles something. For a colour difference, look at the SWF's display-list tags (colour transforms, blend modes) before
anything else; the release's `effects.json` holds them per symbol
([`docs/asset-bundle-format.md`](docs/asset-bundle-format.md#effectsjson)).

## Pull requests

Keep them focused, with tests. Commit messages say what changed and why. Documentation is written in plain English; do not
reword text that already says the same thing, add, correct or remove substance.
