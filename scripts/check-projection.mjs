/**
 * Asserts that src/lib/projection.ts stays in step with cobe's shaders.
 *
 * The globe is drawn on the GPU by cobe, which exposes no picking, so clicks,
 * hover labels and country outlines are positioned by our own copy of its
 * projection. If the two ever drift, signals stop lining up with the dots under
 * them — a failure that is obvious on screen and invisible to the type checker.
 *
 * Run with: npm run check:projection
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(mkdtempSync(join(tmpdir(), 'radio-atlas-')), 'projection.mjs')

execFileSync(
  join(root, 'node_modules', '.bin', 'esbuild'),
  [join(root, 'src', 'lib', 'projection.ts'), '--format=esm', `--outfile=${out}`, '--log-level=error'],
  { stdio: 'inherit' },
)

const { project, invert, lookAt, centreOf, globeRadius, SPHERE_RADIUS } = await import(out)

const failures = []
const check = (label, ok, detail) => {
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`)
}

const view = { phi: 1.1, theta: -0.35, scale: 1, width: 900, height: 700 }
const angleDelta = (a, b) => Math.abs(((a - b + 540) % 360) - 180)

// 1. Screen placement must invert back to the coordinate it came from.
let worstRoundTrip = 0
for (const lat of [-80, -45, -10, 0, 17, 51.5, 78]) {
  for (const lon of [-179, -120, -60, 0, 23, 105, 178]) {
    const point = project(lat, lon, view)
    if (!point.visible) continue
    const back = invert(point.x, point.y, view)
    worstRoundTrip = Math.max(worstRoundTrip, Math.abs(back.lat - lat), angleDelta(back.lon, lon))
  }
}
check('round trip', worstRoundTrip < 1e-9, `worst error ${worstRoundTrip} deg`)

// 2. lookAt must put a coordinate dead centre — this is how focusing works.
let worstCentre = 0
for (const [lat, lon] of [
  [51.5, -0.12],
  [-33.87, 151.21],
  [35.68, 139.69],
  [0, 0],
  [-60, -70],
]) {
  const aimed = { ...view, ...lookAt(lat, lon) }
  const point = project(lat, lon, aimed)
  worstCentre = Math.max(worstCentre, Math.hypot(point.x - aimed.width / 2, point.y - aimed.height / 2))
  const centre = centreOf(aimed)
  worstCentre = Math.max(worstCentre, Math.abs(centre.lat - lat), angleDelta(centre.lon, lon))
}
check('lookAt centring', worstCentre < 1e-9, `worst error ${worstCentre}`)

// 3. The far side of the globe must be hidden, and clicks off the disc must miss.
const facing = { ...view, ...lookAt(0, 0) }
check('antipode hidden', project(0, 180, facing).visible === false)
check('near side visible', project(0, 0, facing).visible === true)
check('off-globe click misses', invert(2, 2, view) === null)

// 4. The drawn radius must match cobe's clip-space sphere of 0.8.
const edge = project(0, 0, facing)
check(
  'radius matches cobe',
  Math.abs(edge.x - facing.width / 2) < 1e-9 &&
    Math.abs(globeRadius(view) - (SPHERE_RADIUS * view.scale * view.height) / 2) < 1e-9,
)

// 5. Zoom must scale positions about the centre, the way cobe's `scale` does.
const zoomed = { ...view, scale: 2 }
const near = project(10, 20, view)
const far = project(10, 20, zoomed)
check(
  'scale is centre-relative',
  Math.abs(far.x - view.width / 2 - 2 * (near.x - view.width / 2)) < 1e-9 &&
    Math.abs(far.y - view.height / 2 - 2 * (near.y - view.height / 2)) < 1e-9,
)

if (failures.length) {
  console.error('projection check FAILED:')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`projection check passed (round trip ${worstRoundTrip.toExponential(2)} deg)`)
