# Images

Map images: their syntax, where they are drawn and where they load from. The index is [`README.md`](README.md); the attribute
tables are in [`settings.md`](settings.md) (`D`, `d`, `APS`, `ARPS`, `IP`), [`grounds.md`](grounds.md) (`i`) and
[`particles.md`](particles.md) (`img`).

## Images in the settings

| Attribute | Syntax | Layer | At load |
|---|---|---|---|
| `D` | `#url,w,h` (a tiled bitmap), or `url` (no comma: at 0,0), or `url,x,y,repeat,dx;url,x,y,repeat,dx;...` | background, behind everything else in it | yes |
| `d` | `url` (no comma: at 0,0), or `;`-separated groups of 4-field tuples `url,x,y,repeat` | top, under the other foreground content | yes |
| `APS` | `;`-separated groups of exactly 8 fields: `url,mode,x,y,w,h,imageX,imageY` (others are skipped) | top | yes, drawn whole at (imageX, imageY); fades out while the player is inside (x, y, w, h) |
| `ARPS` | as `APS` | background | no: fades in while the player is inside its rectangle |
| `IP` | `;`-separated groups of exactly 3 fields: `url,x,y` (others are skipped) | background | no: a server message shows two of them for 5 seconds, on a few event maps |

`x` is an `int`; in a mirrored room an image is placed at `mapWidth - x` and flipped. A restricted map ignores the tiled `D`,
the repeats, `APS`, `ARPS` and `IP`; `ARPS` also needs an official map ([`limits-and-modes.md`](limits-and-modes.md)). Verified
in the game for `D`, `d`, `APS`, `ARPS` and `IP`, mirrored and not.

### Repeats

The fourth field of a `D` or `d` tuple repeats the image: each copy is moved `dx` to the right of the previous one, and `y`
stays. In a mirrored room only the first image is mirrored; its copies still move to the right.

| | `D` | `d` |
|---|---|---|
| Count | `int` of field 4 when it is a number, at most 20 | `int` of field 4 when it is a number, no limit |
| Offset `dx` | field 5 of the same tuple | field 5 of the **last `D` tuple** (a bug of the game: field 5 of a `d` tuple would be the next tuple's URL) |
| No offset | the copies stack on the first image | the same; and without any `D` tuple the map fails to load |
| Offset not a number | the copies jump to x = 0 | the same |
| Negative count | the game hangs | the same |

The in-game editor ignores repeats and reads `d` as plain `url,x,y` triples.

### Tiled background

`D="#url,w,h"` fills a `w` x `h` area with the image repeated. It is drawn only for maps that are not restricted, and some
clients ignore it; the renderer draws it only on request.

## Ground image `i`

`i="x,y,url"` replaces a ground's picture with an image whose top left corner is (`x`, `y`) from the ground's top left corner.
At least three fields are needed; a URL with a comma is cut at the comma. The ground keeps its size and physics. A restricted
map ignores `i` and draws the ground normally. Verified in the game.

## Image URLs

A value is a path below an image base; whether an absolute URL can load depends on the attribute.

| Source | Base | Absolute URL (`://`) |
|---|---|---|
| `D`, `d`, `IP` | `http://www.transformice.com/images/` | cannot load (the base is always prefixed) |
| `APS`, `ARPS` | a bare `name.ext` (letters and digits, one dot): `http://images.atelier801.com/`; anything else: the transformice.com base | cannot load |
| tiled `D="#url,w,h"` | the transformice.com base | loads as written |
| ground `i` | a bare `name.ext`: images.atelier801.com; otherwise the transformice.com base | loads as written, except in `#Module` maps |
| particle `img` | the transformice.com base | cannot load |

A path with slashes stays below the base (`x_deadmeat/x_pictos/s_1205-fs8.png`). The editor's character set has no `?`, so an
editor map cannot write a query string ([`limits-and-modes.md`](limits-and-modes.md)). The game adds a cache stamp
(`?c=<day count>`) to most image requests at run time; it is not part of the map.

## How images load

Every map image is loaded the same way: an empty picture appears at once and fills in when the image arrives. Loads are cached
by URL, at most 10 run at the same time, and each needs the host to allow cross-domain access. An image that fails is dropped
without retry.

The renderer never uses the network itself: images come from a resolver the caller supplies.
