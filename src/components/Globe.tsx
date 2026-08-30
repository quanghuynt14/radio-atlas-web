import { useEffect, useRef } from 'react'
import createGlobe, { type Marker } from 'cobe'
import { geoOrthographic, geoPath } from 'd3-geo'
import type { FeatureCollection } from 'geojson'
import { countryAt, loadCountries, type Country } from '../lib/countries'
import { centreOf, globeRadius, invert, lookAt, project, type View } from '../lib/projection'
import type { Station } from '../lib/types'

/** A station with coordinates resolved — published, or estimated from its country. */
export interface Placed {
  station: Station
  lat: number
  lon: number
  /** Stations of the country being browsed, drawn brighter and picked first. */
  session: boolean
}

interface Props {
  points: Placed[]
  selectedCountry: string | null
  playingUuid: string | null
  selectedUuid: string | null
  /** Set to spin the globe to a place; a new object identity re-triggers it. */
  focus: { lat: number; lon: number } | null
  onPickStation: (station: Station) => void
  onPickCountry: (country: Country) => void
}

const MIN_SCALE = 0.85
const MAX_SCALE = 9
const HIT_RADIUS = 11
const IDLE_SPIN_RAD_PER_SEC = 0.045
const IDLE_DELAY_MS = 3500
/** cobe redraws every marker each frame, so keep the buffer to a sane size. */
const MAX_MARKERS = 2600
const TAU = Math.PI * 2

type Rgb = [number, number, number]

interface Theme {
  base: Rgb
  glow: Rgb
  marker: Rgb
  session: Rgb
  playing: Rgb
  dark: number
  brightness: number
  label: string
  labelText: string
  outline: string
  countryFill: string
}

function hexToRgb(hex: string, fallback: Rgb): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return fallback
  const value = parseInt(match[1], 16)
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

function readTheme(): Theme {
  const styles = getComputedStyle(document.documentElement)
  const read = (name: string) => styles.getPropertyValue(name).trim()
  const isLight = document.documentElement.dataset.theme === 'light'
  return {
    base: hexToRgb(read('--globe-base'), isLight ? [0.82, 0.85, 0.92] : [0.24, 0.29, 0.4]),
    glow: hexToRgb(read('--globe-glow'), isLight ? [0.78, 0.84, 0.95] : [0.06, 0.09, 0.16]),
    marker: hexToRgb(read('--globe-signal'), [0.36, 0.55, 0.9]),
    session: hexToRgb(read('--globe-session'), [0.4, 0.91, 0.98]),
    playing: hexToRgb(read('--globe-playing'), [0.96, 0.77, 0.33]),
    dark: isLight ? 0 : 1,
    brightness: isLight ? 8 : 5.4,
    label: read('--globe-label-bg') || 'rgba(9,14,25,0.9)',
    labelText: read('--globe-label') || '#e8eefc',
    outline: read('--globe-outline') || '#67e8f9',
    countryFill: read('--globe-country-fill') || 'rgba(103,232,249,0.14)',
  }
}

export default function Globe({
  points,
  selectedCountry,
  playingUuid,
  selectedUuid,
  focus,
  onPickStation,
  onPickCountry,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const globeCanvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  // The render loop reads everything through refs: it runs at frame rate and
  // must never wait for React state to settle.
  const view = useRef<View>({ phi: 4.8, theta: 0.35, scale: 1, width: 1, height: 1 })
  const target = useRef<{ phi: number; theta: number } | null>(null)
  const dragging = useRef(false)
  const dragged = useRef(false)
  const pointer = useRef<{ x: number; y: number } | null>(null)
  const hovered = useRef<Placed | null>(null)
  const lastInteraction = useRef(performance.now())
  const geometry = useRef<{ countries: Country[]; land: FeatureCollection } | null>(null)
  const theme = useRef<Theme>(readTheme())
  const markersDirty = useRef(true)

  const data = useRef({ points, selectedCountry, playingUuid, selectedUuid })
  data.current = { points, selectedCountry, playingUuid, selectedUuid }

  const callbacks = useRef({ onPickStation, onPickCountry })
  callbacks.current = { onPickStation, onPickCountry }

  useEffect(() => {
    let cancelled = false
    void loadCountries().then((loaded) => {
      if (!cancelled) geometry.current = loaded
    })
    return () => {
      cancelled = true
    }
  }, [])

  // Rebuild cobe's marker buffer only when the signals themselves change.
  useEffect(() => {
    markersDirty.current = true
  }, [points, playingUuid, selectedUuid])

  useEffect(() => {
    if (!focus) return
    target.current = lookAt(focus.lat, focus.lon)
    lastInteraction.current = performance.now()
  }, [focus])

  useEffect(() => {
    const wrap = wrapRef.current
    const globeCanvas = globeCanvasRef.current
    const overlay = overlayRef.current
    if (!wrap || !globeCanvas || !overlay) return

    const context = overlay.getContext('2d')
    if (!context) return

    let globe: { update: (state: Record<string, unknown>) => void; destroy: () => void } | null = null
    let ratio = Math.min(window.devicePixelRatio || 1, 2)
    let frame = 0
    let previous = performance.now()
    let disposed = false

    const buildMarkers = (): Marker[] => {
      const { points: all, playingUuid: playing, selectedUuid: chosen } = data.current
      const colours = theme.current
      const markers: Marker[] = []
      for (const placed of all) {
        const isPlaying = placed.station.uuid === playing
        const isChosen = placed.station.uuid === chosen
        // Past the budget only the signals that matter keep their marker.
        if (markers.length >= MAX_MARKERS && !placed.session && !isPlaying && !isChosen) continue
        markers.push({
          location: [placed.lat, placed.lon],
          size: isPlaying ? 0.055 : isChosen ? 0.04 : placed.session ? 0.03 : 0.018,
          color: isPlaying ? colours.playing : isChosen ? colours.session : placed.session ? colours.session : colours.marker,
        })
      }
      return markers
    }

    const createInstance = () => {
      const rect = wrap.getBoundingClientRect()
      view.current.width = Math.max(1, rect.width)
      view.current.height = Math.max(1, rect.height)
      ratio = Math.min(window.devicePixelRatio || 1, 2)

      globe?.destroy()
      const colours = theme.current
      globe = createGlobe(globeCanvas, {
        devicePixelRatio: ratio,
        width: view.current.width * ratio,
        height: view.current.height * ratio,
        phi: view.current.phi,
        theta: view.current.theta,
        dark: colours.dark,
        diffuse: 1.25,
        mapSamples: 22000,
        mapBrightness: colours.brightness,
        baseColor: colours.base,
        markerColor: colours.marker,
        glowColor: colours.glow,
        scale: view.current.scale,
        markers: buildMarkers(),
      }) as unknown as { update: (state: Record<string, unknown>) => void; destroy: () => void }
      markersDirty.current = false

      overlay.width = Math.round(view.current.width * ratio)
      overlay.height = Math.round(view.current.height * ratio)
      overlay.style.width = `${view.current.width}px`
      overlay.style.height = `${view.current.height}px`
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
    }

    createInstance()

    // Recreating the WebGL context is the reliable way to resize cobe, so it is
    // debounced to survive a window drag without rebuilding on every frame.
    let resizeTimer = 0
    const observer = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        if (!disposed) createInstance()
      }, 140)
    })
    observer.observe(wrap)

    const themeObserver = new MutationObserver(() => {
      theme.current = readTheme()
      if (!disposed) createInstance()
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const nearest = (x: number, y: number): Placed | null => {
      let best: Placed | null = null
      let bestDistance = HIT_RADIUS * HIT_RADIUS
      for (const placed of data.current.points) {
        const position = project(placed.lat, placed.lon, view.current)
        if (!position.visible) continue
        const dx = position.x - x
        const dy = position.y - y
        // Session signals win ties so a country browse stays clickable through
        // the world's background stations.
        const distance = dx * dx + dy * dy - (placed.session ? 12 : 0)
        if (distance < bestDistance) {
          bestDistance = distance
          best = placed
        }
      }
      return best
    }

    const drawOverlay = (now: number) => {
      const { width, height } = view.current
      const colours = theme.current
      context.clearRect(0, 0, width, height)

      const geo = geometry.current
      const selected = data.current.selectedCountry
      if (geo && selected) {
        const centre = centreOf(view.current)
        const projection = geoOrthographic()
          .rotate([-centre.lon, -centre.lat, 0])
          .scale(globeRadius(view.current))
          .translate([width / 2, height / 2])
          .clipAngle(90)
        const match = geo.countries.find((country) => country.code === selected)
        if (match) {
          const path = geoPath(projection, context)
          context.beginPath()
          path(match.feature)
          context.fillStyle = colours.countryFill
          context.fill()
          context.strokeStyle = colours.outline
          context.lineWidth = 1.1
          context.stroke()
        }
      }

      const ring = (uuid: string | null, radius: number, colour: string, alpha: number) => {
        if (!uuid) return
        const placed = data.current.points.find((item) => item.station.uuid === uuid)
        if (!placed) return
        const position = project(placed.lat, placed.lon, view.current)
        if (!position.visible) return
        context.beginPath()
        context.arc(position.x, position.y, radius, 0, Math.PI * 2)
        context.strokeStyle = colour
        context.globalAlpha = alpha
        context.lineWidth = 1.5
        context.stroke()
        context.globalAlpha = 1
      }

      ring(data.current.selectedUuid, 9, colours.outline, 0.9)
      ring(data.current.playingUuid, 11 + Math.sin(now / 340) * 3.5, colours.labelText, 0.5)

      const cursor = pointer.current
      hovered.current = cursor && !dragging.current ? nearest(cursor.x, cursor.y) : null
      const hover = hovered.current
      if (hover) {
        const position = project(hover.lat, hover.lon, view.current)
        if (position.visible) {
          const text = hover.station.name
          context.font = '12px ui-sans-serif, system-ui, -apple-system, sans-serif'
          const boxWidth = context.measureText(text).width + 18
          const x = Math.min(Math.max(position.x - boxWidth / 2, 8), Math.max(8, width - boxWidth - 8))
          const y = Math.max(position.y - 32, 8)
          context.fillStyle = colours.label
          context.beginPath()
          context.roundRect(x, y, boxWidth, 24, 7)
          context.fill()
          context.fillStyle = colours.labelText
          context.fillText(text, x + 9, y + 16)
        }
      }

      overlay.style.cursor = dragging.current ? 'grabbing' : hover ? 'pointer' : 'grab'
    }

    const render = (now: number) => {
      const elapsed = Math.min(64, now - previous)
      previous = now

      const goal = target.current
      if (goal) {
        const step = 1 - Math.pow(0.0035, elapsed / 1000)
        const deltaPhi = shortestAngle(goal.phi - view.current.phi)
        const deltaTheta = goal.theta - view.current.theta
        view.current.phi += deltaPhi * step
        view.current.theta += deltaTheta * step
        if (Math.abs(deltaPhi) < 0.002 && Math.abs(deltaTheta) < 0.002) {
          view.current.phi = goal.phi
          view.current.theta = goal.theta
          target.current = null
        }
      } else if (!dragging.current && now - lastInteraction.current > IDLE_DELAY_MS) {
        view.current.phi += (IDLE_SPIN_RAD_PER_SEC * elapsed) / 1000
      }
      // Keep phi bounded so a globe left spinning overnight stays precise.
      view.current.phi = ((view.current.phi % TAU) + TAU) % TAU

      if (globe) {
        const update: Record<string, unknown> = {
          phi: view.current.phi,
          theta: view.current.theta,
          scale: view.current.scale,
        }
        if (markersDirty.current) {
          update.markers = buildMarkers()
          markersDirty.current = false
        }
        globe.update(update)
      }

      drawOverlay(now)
      frame = requestAnimationFrame(render)
    }

    frame = requestAnimationFrame(render)

    const local = (event: PointerEvent | MouseEvent | WheelEvent) => {
      const rect = overlay.getBoundingClientRect()
      return { x: event.clientX - rect.left, y: event.clientY - rect.top }
    }

    let dragOrigin = { x: 0, y: 0 }
    let viewOrigin = { phi: 0, theta: 0 }

    const onPointerDown = (event: PointerEvent) => {
      overlay.setPointerCapture(event.pointerId)
      dragging.current = true
      dragged.current = false
      target.current = null
      dragOrigin = local(event)
      viewOrigin = { phi: view.current.phi, theta: view.current.theta }
      lastInteraction.current = performance.now()
    }

    const onPointerMove = (event: PointerEvent) => {
      pointer.current = local(event)
      if (!dragging.current) return
      const dx = pointer.current.x - dragOrigin.x
      const dy = pointer.current.y - dragOrigin.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragged.current = true
      // Radians per pixel shrinks with zoom, so the surface keeps up with the
      // cursor at every scale.
      const perPixel = 1 / globeRadius(view.current)
      view.current.phi = viewOrigin.phi - dx * perPixel
      view.current.theta = clamp(viewOrigin.theta + dy * perPixel, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
      lastInteraction.current = performance.now()
    }

    const endDrag = (event: PointerEvent) => {
      if (!dragging.current) return
      dragging.current = false
      if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId)
      lastInteraction.current = performance.now()
    }

    const onClick = (event: MouseEvent) => {
      if (dragged.current) return
      const { x, y } = local(event)
      const station = nearest(x, y)
      if (station) {
        callbacks.current.onPickStation(station.station)
        return
      }
      const coordinate = invert(x, y, view.current)
      const geo = geometry.current
      if (!coordinate || !geo) return
      const country = countryAt(geo.countries, coordinate.lon, coordinate.lat)
      if (country) callbacks.current.onPickCountry(country)
    }

    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      view.current.scale = clamp(view.current.scale * Math.exp(-event.deltaY * 0.0012), MIN_SCALE, MAX_SCALE)
      lastInteraction.current = performance.now()
    }

    const onLeave = () => {
      pointer.current = null
    }

    overlay.addEventListener('pointerdown', onPointerDown)
    overlay.addEventListener('pointermove', onPointerMove)
    overlay.addEventListener('pointerup', endDrag)
    overlay.addEventListener('pointercancel', endDrag)
    overlay.addEventListener('pointerleave', onLeave)
    overlay.addEventListener('click', onClick)
    overlay.addEventListener('wheel', onWheel, { passive: false })

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      window.clearTimeout(resizeTimer)
      observer.disconnect()
      themeObserver.disconnect()
      overlay.removeEventListener('pointerdown', onPointerDown)
      overlay.removeEventListener('pointermove', onPointerMove)
      overlay.removeEventListener('pointerup', endDrag)
      overlay.removeEventListener('pointercancel', endDrag)
      overlay.removeEventListener('pointerleave', onLeave)
      overlay.removeEventListener('click', onClick)
      overlay.removeEventListener('wheel', onWheel)
      globe?.destroy()
    }
  }, [])

  return (
    <div className="globe" ref={wrapRef}>
      <canvas className="globe-gl" ref={globeCanvasRef} />
      <canvas
        className="globe-overlay"
        ref={overlayRef}
        role="img"
        aria-label="Rotatable globe of live radio stations"
      />
    </div>
  )
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Normalises an angle difference into (-PI, PI] so spins take the short way. */
function shortestAngle(radians: number): number {
  return (((radians % TAU) + TAU + Math.PI) % TAU) - Math.PI
}
