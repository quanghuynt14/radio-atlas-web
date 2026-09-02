/**
 * Deciding which signals cobe draws, and how big.
 *
 * Two facts about cobe drive everything here. It adds a marker's size to its
 * position in the globe's own space and only then multiplies by `scale`, so a
 * dot's width on screen grows with the zoom. And it offers no picking, so the
 * set drawn here is also the set that can be hovered and clicked.
 *
 * Together those mean zooming in used to make signals worse, not better: the
 * dots inflated until neighbours merged into blobs with nothing legible under
 * them. Thinning by cell and shrinking by zoom turn that around — closing in
 * spreads signals apart and reveals the ones that were hidden.
 *
 * Guarded by scripts/check-markers.mjs.
 */
import { globeRadius, type View } from './projection'
import type { Station } from './types'

/** A station with coordinates resolved — published, or estimated from its country. */
export interface Placed {
  station: Station
  lat: number
  lon: number
  /** Stations of the country being browsed, drawn brighter and picked first. */
  session: boolean
}

/** One signal that survived thinning, and the crowd it now stands for. */
export interface Drawn {
  placed: Placed
  hidden: number
}

/** On-screen spacing signals are thinned to, in CSS pixels. */
export const MARKER_SPACING = 11

/**
 * How marker size answers the zoom. An exponent of 1 would pin dots to a fixed
 * pixel width; a little less lets them gain some presence as you close in
 * without ever growing enough to merge.
 */
export const MARKER_ZOOM_EXPONENT = 0.85

/** cobe redraws every marker each frame, so keep the buffer to a sane size. */
export const MAX_MARKERS = 6000

export interface ThinOptions {
  playingUuid: string | null
  selectedUuid: string | null
  spacing?: number
  limit?: number
}

/** What makes one signal the right one to speak for a crowded cell. */
function rank(placed: Placed, options: ThinOptions): number {
  const { station } = placed
  if (station.uuid === options.playingUuid) return Number.MAX_SAFE_INTEGER
  if (station.uuid === options.selectedUuid) return Number.MAX_SAFE_INTEGER - 1
  const popularity = Math.min(station.votes + station.clicks, 1e6)
  return (placed.session ? 1e7 : 0) + popularity
}

/**
 * Collapses signals that would land on top of each other into one dot per cell,
 * keeping the most notable of them and counting the rest.
 *
 * The grid is measured in degrees, sized from the current zoom, rather than in
 * screen pixels: a pixel grid would depend on the rotation too, and dots would
 * flicker in and out as the globe spun. This way only zooming changes what is
 * drawn, which is exactly when new detail should appear.
 */
export function thin(points: Placed[], view: View, options: ThinOptions): Drawn[] {
  const spacing = options.spacing ?? MARKER_SPACING
  const limit = options.limit ?? MAX_MARKERS
  const perDegree = (globeRadius(view) * Math.PI) / 180
  const latCell = Math.min(20, Math.max(0.01, spacing / perDegree))
  const cells = new Map<string, Drawn>()

  for (const placed of points) {
    // Meridians crowd together near the poles, so cells widen to match.
    const lonCell = latCell / Math.max(Math.cos((placed.lat * Math.PI) / 180), 0.15)
    const key = `${Math.round(placed.lat / latCell)}:${Math.round(placed.lon / lonCell)}`
    const cell = cells.get(key)
    if (!cell) {
      cells.set(key, { placed, hidden: 0 })
      continue
    }
    cell.hidden += 1
    if (rank(placed, options) > rank(cell.placed, options)) cell.placed = placed
  }

  const kept = [...cells.values()]
  if (kept.length > limit) {
    kept.sort((a, b) => rank(b.placed, options) - rank(a.placed, options))
    kept.length = limit
  }
  return kept
}

/** The `size` to hand cobe for a dot that should read as `base` at scale 1. */
export function markerSize(base: number, scale: number): number {
  return base / Math.pow(scale, MARKER_ZOOM_EXPONENT)
}

/** What that dot actually measures on screen, in CSS pixels. */
export function markerRadius(base: number, view: View): number {
  // cobe's marker quad spans `size * 2` in globe space and its fragment shader
  // keeps the inner quarter, so the drawn radius is size/2 — then scaled, then
  // mapped from clip space, where the full height covers 2 units.
  return (markerSize(base, view.scale) * view.scale * view.height) / 4
}
