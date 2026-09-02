# Radio Atlas (web)

Explore live radio on a rotatable globe in the browser. Click a signal to play
it, or click a country to browse its stations. A web port of the
[Omarchy Radio Atlas](https://github.com/AksharP5/omarchy-radio-atlas) plugin,
rendered with the same dotted WebGL globe that [datafa.st](https://datafa.st)
uses.

## Run

```bash
npm install
npm run dev        # http://127.0.0.1:5178
```

```bash
npm run check      # types + projection invariants
npm run build      # production bundle into dist/
```

Prefer serving over `http://localhost` in development. A page served over
`https` cannot load a station that streams over plain `http`, and roughly a
third of the directory still does; the player detects this case and says so
instead of failing silently.

## Controls

The globe is direct manipulation: drag it and the surface goes where the pointer
goes, on both axes.

| Input | Action |
| --- | --- |
| Drag globe | Rotate |
| Wheel / pinch over globe | Zoom |
| Click or tap a signal | Play station |
| Click or tap a country | Browse country |
| `/` | Focus search |
| Up / Down | Move through stations |
| Enter | Play selected station |
| Space | Play or pause |
| `R` | Tune a random station |
| `F` | Favourite selected station |
| `+` / `-` | Raise or lower volume |
| `M` | Mute or unmute |
| Escape | Clear search, close the sheet |

On a phone the globe takes the whole screen, with a now-playing bar at the
bottom that drags up into the full station list. The theme follows the system by
default; the control on the globe cycles system, light and dark.

## How it fits together

| Module | Role |
| --- | --- |
| `lib/radioBrowser.ts` | Radio Browser client: mirror failover, row validation, click reporting |
| `lib/cache.ts` | IndexedDB station cache — stale results paint instantly, fresh ones replace them |
| `lib/countries.ts` | Natural Earth outlines joined to ISO alpha-2 codes; country hit-testing and centroids |
| `lib/projection.ts` | cobe's projection in TypeScript, so the globe can be clicked |
| `lib/state.ts` | Favourites, history and volume in `localStorage` |
| `hooks/useCatalog.ts` | Progressive world load, country browsing, search |
| `hooks/usePlayer.ts` | Stream playback, mixed-content detection, skip-on-failure |
| `components/Globe.tsx` | cobe globe plus a 2D overlay for labels, rings and country outlines |
| `lib/theme.ts` | Theme preference, resolved to the `data-theme` the globe palette reads |

### Why the projection is duplicated

[cobe](https://github.com/shuding/cobe) draws the globe entirely on the GPU and
exposes no way to ask "what is under this pixel". Every interaction — clicking a
signal, picking a country, placing a hover label, outlining the selected
country — needs that answer, so `lib/projection.ts` reimplements cobe's
placement on the CPU.

It is transcribed from cobe 2.0.1's shaders rather than guessed:

- a marker at `[lat, lon]` sits at `[-cos(lat)cos(lon-PI), sin(lat), cos(lat)sin(lon-PI)]`
- the sphere is drawn at radius `0.8` in clip space
- the camera rotation is `Rx(theta) . Ry(phi)`
- clip x is squashed by `height/width`, so both axes scale with the height

The marker vertex shader and the map fragment shader agree — the fragment
shader's inverse rotation is exactly the transpose of the vertex shader's — and
`project`/`invert` match both. `npm run check:projection` asserts the
round trip, the framing of `lookAt`, far-side culling, the drawn radius and the
behaviour of zoom, so a cobe upgrade that moves any of this fails loudly rather
than quietly sliding the signals off the map.

## Data and privacy

Station data comes from the community-run
[Radio Browser](https://www.radio-browser.info/). Playing a station calls its
click-count endpoint, the same courtesy the desktop plugin pays. Browsers cannot
set a User-Agent, so the client identifies itself with a `client` query
parameter instead.

Favourites, listening history and volume stay in `localStorage`; the station
cache stays in IndexedDB. Nothing is sent anywhere else. Station metadata and
stream URLs are community supplied and rendered as plain text — the app connects
directly to third-party streams, and `http` streams are unencrypted. Only play
stations you trust.

Map geometry is public-domain Natural Earth data (via `world-atlas`), bundled at
`public/data/countries-110m.json`.

## Credits and licence

This project is MIT licensed. It is an independent web reimplementation of
[Radio Atlas](https://github.com/AksharP5/omarchy-radio-atlas) by Akshar Patel,
which is MIT licensed and whose behaviour and keyboard bindings it follows.
The globe is drawn with [cobe](https://github.com/shuding/cobe) (MIT) by Shu
Ding. Station data is from [Radio Browser](https://www.radio-browser.info/);
map geometry is public-domain [Natural Earth](https://www.naturalearthdata.com/)
data via [world-atlas](https://github.com/topojson/world-atlas).
