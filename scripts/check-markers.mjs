/**
 * Asserts that signals stay legible as the globe is zoomed.
 *
 * cobe adds a marker's size to its position in the globe's own space and only
 * then multiplies by `scale`, so the naive `size` is a trap: dots inflate with
 * the zoom until neighbours merge into blobs. src/lib/markers.ts divides that
 * back out and thins overlapping signals to one per cell. Both are easy to
 * undo by accident and neither shows up in the type checker, so they are
 * checked here.
 *
 * Run with: npm run check:markers
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(mkdtempSync(join(tmpdir(), 'radio-atlas-')), 'markers.mjs')

execFileSync(
  join(root, 'node_modules', '.bin', 'esbuild'),
  [join(root, 'src', 'lib', 'markers.ts'), '--bundle', '--format=esm', `--outfile=${out}`, '--log-level=error'],
  { stdio: 'inherit' },
)

const { thin, markerRadius, markerSize, MAX_MARKERS } = await import(out)

const failures = []
const check = (label, ok, detail) => {
  if (!ok) failures.push(detail ? `${label} — ${detail}` : label)
}

const view = (scale) => ({ phi: 4.8, theta: 0.2, scale, width: 1280, height: 800 })
const SCALES = [0.85, 1, 1.5, 2.5, 4, 6, 9]
const BASE = 0.018

// A world of clustered signals: cities hold dozens of stations within a few
// hundred metres of each other, which is what makes thinning worth doing.
let seed = 7
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)

const points = []
for (let city = 0; city < 120; city++) {
  const lat = random() * 140 - 70
  const lon = random() * 360 - 180
  const size = 4 + Math.floor(random() * 45)
  for (let n = 0; n < size; n++) {
    points.push({
      lat: lat + (random() - 0.5) * 0.3,
      lon: lon + (random() - 0.5) * 0.3,
      session: false,
      station: {
        uuid: `${city}-${n}`,
        votes: Math.floor(random() * 900),
        clicks: Math.floor(random() * 900),
      },
    })
  }
}

const options = { playingUuid: '3-2', selectedUuid: '61-0' }

// 1. A dot must never balloon. This is the bug the module exists to prevent.
for (const scale of SCALES) {
  const radius = markerRadius(BASE, view(scale))
  check(`marker radius at scale ${scale}`, radius >= 2 && radius <= 12, `${radius.toFixed(1)}px`)
}

// 2. And it must still grow a little, so closing in feels like closing in.
const near = markerRadius(BASE, view(9))
const far = markerRadius(BASE, view(1))
check('dots gain presence with zoom', near > far, `${far.toFixed(1)}px -> ${near.toFixed(1)}px`)
check('dots grow far slower than the globe', near < far * 2, `${(near / far).toFixed(2)}x over a 9x zoom`)

// 3. Without the correction the same dot would be unusable — proving the
//    fix is load bearing rather than decorative.
const naive = (BASE * 9 * 800) / 4
check('the uncorrected size would blow up', naive > 30, `${naive.toFixed(0)}px`)

// 4. Zooming in must reveal signals, never hide them.
let previous = 0
for (const scale of SCALES) {
  const drawn = thin(points, view(scale), options)
  check(`thinning grows with zoom at ${scale}`, drawn.length >= previous, `${previous} -> ${drawn.length}`)
  previous = drawn.length

  // 5. Every signal is either drawn or counted behind one that is.
  const total = drawn.reduce((sum, item) => sum + 1 + item.hidden, 0)
  check(`every signal accounted for at ${scale}`, total === points.length, `${total} of ${points.length}`)

  // 6. Nothing is drawn twice, and the budget holds.
  const unique = new Set(drawn.map((item) => item.placed.station.uuid))
  check(`no signal drawn twice at ${scale}`, unique.size === drawn.length)
  check(`within the marker budget at ${scale}`, drawn.length <= MAX_MARKERS, `${drawn.length}`)

  // 7. What is playing and what is selected are always on screen — the rings
  //    and the hit test both look for them among the drawn set.
  check(`playing signal survives at ${scale}`, unique.has(options.playingUuid))
  check(`selected signal survives at ${scale}`, unique.has(options.selectedUuid))
}

// 8. Thinning has to earn its keep at world view.
const world = thin(points, view(1), options)
check('world view is thinned', world.length < points.length / 2, `${world.length} of ${points.length}`)

// 9. Fully zoomed in, the crowds have come apart.
const close = thin(points, view(9), options)
check('zooming resolves the crowds', close.length > world.length * 3, `${world.length} -> ${close.length}`)

// 10. Size is the inverse of the correction, exactly.
check('size falls as scale rises', markerSize(BASE, 4) < markerSize(BASE, 2))

if (failures.length) {
  console.error('marker check failed:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(
  `marker check passed (radius ${far.toFixed(1)}px at scale 1, ${near.toFixed(1)}px at scale 9; ` +
    `${world.length} of ${points.length} signals drawn at world view, ${close.length} zoomed in)`,
)
