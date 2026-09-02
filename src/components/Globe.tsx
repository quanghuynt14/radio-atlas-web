import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import createGlobe, { type Marker } from 'cobe'
import { geoOrthographic, geoPath } from 'd3-geo'
import type { FeatureCollection } from 'geojson'
import { countryAt, loadCountries, type Country } from '../lib/countries'
import { markerSize, thin, type Drawn, type Placed } from '../lib/markers'
import { centreOf, globeRadius, invert, lookAt, project, type View } from '../lib/projection'
import type { Station } from '../lib/types'

export type { Placed } from '../lib/markers'

/** Zoom is driven from outside for the on-screen controls and keyboard. */
export interface GlobeHandle {
  zoomBy: (factor: number) => void
  resetZoom: () => void
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
/** Pick radius in CSS pixels — a fingertip needs a wider net than a cursor. */
const HIT_RADIUS_MOUSE = 11
const HIT_RADIUS_TOUCH = 22
const IDLE_SPIN_RAD_PER_SEC = 0.045
const IDLE_DELAY_MS = 3500
/** Zoom is bucketed so the thinning only redoes itself in visible steps. */
const ZOOM_BUCKET = 1.25
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

const Globe = forwardRef<GlobeHandle, Props>(function Globe(
  { points, selectedCountry, playingUuid, selectedUuid, focus, onPickStation, onPickCountry },
  ref,
) {
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
  const hovered = useRef<Drawn | null>(null)
  const lastInteraction = useRef(performance.now())
  const geometry = useRef<{ countries: Country[]; land: FeatureCollection } | null>(null)
  const theme = useRef<Theme>(readTheme())
  const markersDirty = useRef(true)
  const hitRadius = useRef(HIT_RADIUS_MOUSE)
  /** The thinned set: what is on screen, and so what can be hovered or picked. */
  const drawn = useRef<Drawn[]>([])

  const data = useRef({ points, selectedCountry, playingUuid, selectedUuid })
  data.current = { points, selectedCountry, playingUuid, selectedUuid }

  const callbacks = useRef({ onPickStation, onPickCountry })
  callbacks.current = { onPickStation, onPickCountry }

  // The render loop reads scale off the ref every frame, so the controls can
  // write straight to it without a re-render.
  useImperativeHandle(ref, () => ({
    zoomBy: (factor) => {
      view.current.scale = clamp(view.current.scale * factor, MIN_SCALE, MAX_SCALE)
      lastInteraction.current = performance.now()
    },
    resetZoom: () => {
      view.current.scale = 1
      lastInteraction.current = performance.now()
    },
  }), [])

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
    const stillness = window.matchMedia('(prefers-reduced-motion: reduce)')

    const rethin = () =>
      thin(data.current.points, view.current, {
        playingUuid: data.current.playingUuid,
        selectedUuid: data.current.selectedUuid,
      })

    const buildMarkers = (): Marker[] => {
      const { playingUuid: playing, selectedUuid: chosen } = data.current
      const colours = theme.current

      return drawn.current.map(({ placed, hidden }) => {
        const isPlaying = placed.station.uuid === playing
        const isChosen = placed.station.uuid === chosen
        const base = isPlaying ? 0.055 : isChosen ? 0.042 : placed.session ? 0.03 : 0.018
        // A dot standing in for a crowd carries a little of its weight, so
        // dense cities still read as dense at a glance.
        const crowd = isPlaying || isChosen ? 1 : 1 + Math.min(hidden, 24) / 48
        return {
          location: [placed.lat, placed.lon] as [number, number],
          size: markerSize(base * crowd, view.current.scale),
          color: isPlaying ? colours.playing : isChosen || placed.session ? colours.session : colours.marker,
        }
      })
    }

    /** Zoom at which the thinning and the marker sizes were last uploaded. */
    let thinnedBucket = Number.NaN
    let sizedScale = 0
    const bucketOf = (scale: number) => Math.round(Math.log(scale) / Math.log(ZOOM_BUCKET))

    const createInstance = () => {
      const rect = wrap.getBoundingClientRect()
      view.current.width = Math.max(1, rect.width)
      view.current.height = Math.max(1, rect.height)
      ratio = Math.min(window.devicePixelRatio || 1, 2)

      // Cell size comes off the globe's radius, so thin after the resize.
      drawn.current = rethin()
      thinnedBucket = bucketOf(view.current.scale)
      sizedScale = view.current.scale

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

    // Only drawn signals can be picked, so what you click is always the dot you
    // aimed at rather than something hidden underneath it.
    const nearest = (x: number, y: number): Drawn | null => {
      let best: Drawn | null = null
      let bestDistance = hitRadius.current * hitRadius.current
      for (const candidate of drawn.current) {
        const { placed } = candidate
        const position = project(placed.lat, placed.lon, view.current)
        if (!position.visible) continue
        const dx = position.x - x
        const dy = position.y - y
        // Session signals win ties so a country browse stays clickable through
        // the world's background stations.
        const distance = dx * dx + dy * dy - (placed.session ? 12 : 0)
        if (distance < bestDistance) {
          bestDistance = distance
          best = candidate
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
        const hit = drawn.current.find((item) => item.placed.station.uuid === uuid)
        if (!hit) return
        const position = project(hit.placed.lat, hit.placed.lon, view.current)
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
      const pulse = stillness.matches ? 12 : 11 + Math.sin(now / 340) * 3.5
      ring(data.current.playingUuid, pulse, colours.labelText, 0.5)

      const cursor = pointer.current
      hovered.current = cursor && !dragging.current ? nearest(cursor.x, cursor.y) : null
      const hover = hovered.current
      if (hover) {
        const position = project(hover.placed.lat, hover.placed.lon, view.current)
        if (position.visible) {
          const { station } = hover.placed
          const title = fit(context, station.name, `600 12px ${LABEL_FONT}`, LABEL_MAX)
          // A dot standing in for others says so, rather than quietly lying
          // about how many signals are under the cursor.
          // Only promise that zooming helps while there is zoom left to give;
          // stations sharing one published coordinate never come apart.
          const roomToZoom = view.current.scale < MAX_SCALE * 0.9
          const detail = hover.hidden
            ? `+${hover.hidden} more here${roomToZoom ? ' — zoom in' : ''}`
            : [station.country, station.bitrate ? `${station.bitrate} kbps` : ''].filter(Boolean).join(' · ')
          const subtitle = detail ? fit(context, detail, `11px ${LABEL_FONT}`, LABEL_MAX) : ''

          context.font = `600 12px ${LABEL_FONT}`
          const titleWidth = context.measureText(title).width
          context.font = `11px ${LABEL_FONT}`
          const subtitleWidth = subtitle ? context.measureText(subtitle).width : 0

          const boxWidth = Math.max(titleWidth, subtitleWidth) + 20
          const boxHeight = subtitle ? 40 : 25
          const x = Math.min(Math.max(position.x - boxWidth / 2, 8), Math.max(8, width - boxWidth - 8))
          const y = Math.max(position.y - boxHeight - 12, 8)

          context.fillStyle = colours.label
          context.beginPath()
          context.roundRect(x, y, boxWidth, boxHeight, 8)
          context.fill()

          context.fillStyle = colours.labelText
          context.font = `600 12px ${LABEL_FONT}`
          context.fillText(title, x + 10, y + 17)
          if (subtitle) {
            context.font = `11px ${LABEL_FONT}`
            context.globalAlpha = 0.62
            context.fillText(subtitle, x + 10, y + 32)
            context.globalAlpha = 1
          }
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
      } else if (!dragging.current && !stillness.matches && now - lastInteraction.current > IDLE_DELAY_MS) {
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
        // Thinning is redone in zoom steps, but sizes follow the zoom the whole
        // way, so dots never jump when a step is crossed.
        const bucket = bucketOf(view.current.scale)
        let reupload = markersDirty.current || bucket !== thinnedBucket
        if (reupload) {
          drawn.current = rethin()
          thinnedBucket = bucket
          markersDirty.current = false
        } else if (Math.abs(view.current.scale - sizedScale) > sizedScale * 0.004) {
          reupload = true
        }
        if (reupload) {
          update.markers = buildMarkers()
          sizedScale = view.current.scale
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
    /** Every pointer currently down, so two fingers can pinch. */
    const contacts = new Map<number, { x: number; y: number }>()
    let pinch: { span: number; scale: number } | null = null

    const span = () => {
      const [a, b] = [...contacts.values()]
      return Math.hypot(a.x - b.x, a.y - b.y)
    }

    const beginDrag = (from: { x: number; y: number }) => {
      dragOrigin = from
      viewOrigin = { phi: view.current.phi, theta: view.current.theta }
      dragging.current = true
      target.current = null
    }

    const onPointerDown = (event: PointerEvent) => {
      overlay.setPointerCapture(event.pointerId)
      contacts.set(event.pointerId, local(event))
      hitRadius.current = event.pointerType === 'mouse' ? HIT_RADIUS_MOUSE : HIT_RADIUS_TOUCH
      lastInteraction.current = performance.now()

      if (contacts.size === 2) {
        // A second finger takes over as a pinch, and rules out a tap.
        dragging.current = false
        dragged.current = true
        pinch = { span: span(), scale: view.current.scale }
        return
      }
      dragged.current = false
      beginDrag(local(event))
    }

    const onPointerMove = (event: PointerEvent) => {
      const point = local(event)
      pointer.current = point
      if (contacts.has(event.pointerId)) contacts.set(event.pointerId, point)

      if (pinch && contacts.size === 2) {
        const current = span()
        if (pinch.span > 0) {
          view.current.scale = clamp((pinch.scale * current) / pinch.span, MIN_SCALE, MAX_SCALE)
        }
        lastInteraction.current = performance.now()
        return
      }

      if (!dragging.current) return
      const dx = point.x - dragOrigin.x
      const dy = point.y - dragOrigin.y
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragged.current = true
      // Radians per pixel shrinks with zoom, so the surface keeps up with the
      // pointer at every scale. Both axes track it directly: drag right and the
      // surface travels right, the way a hand on a real globe would move it.
      const perPixel = 1 / globeRadius(view.current)
      view.current.phi = viewOrigin.phi + dx * perPixel
      view.current.theta = clamp(viewOrigin.theta + dy * perPixel, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05)
      lastInteraction.current = performance.now()
    }

    const endDrag = (event: PointerEvent) => {
      contacts.delete(event.pointerId)
      if (overlay.hasPointerCapture(event.pointerId)) overlay.releasePointerCapture(event.pointerId)
      // A finger has no resting position, so the hover label goes with it.
      if (event.pointerType !== 'mouse') pointer.current = null

      if (contacts.size === 1) {
        pinch = null
        // One finger left after a pinch — carry on rotating from where it is.
        beginDrag([...contacts.values()][0])
      } else if (!contacts.size) {
        pinch = null
        dragging.current = false
      }
      lastInteraction.current = performance.now()
    }

    const onClick = (event: MouseEvent) => {
      if (dragged.current) return
      const { x, y } = local(event)
      const hit = nearest(x, y)
      if (hit) {
        callbacks.current.onPickStation(hit.placed.station)
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
        aria-label="Rotatable globe of live radio stations. Drag to spin, pinch or scroll to zoom, tap a country to browse it."
      />
    </div>
  )
})

export default Globe

const LABEL_FONT = "ui-sans-serif, system-ui, -apple-system, sans-serif"
const LABEL_MAX = 240

/** Trims a label to fit, with an ellipsis, so a long name cannot run off. */
function fit(context: CanvasRenderingContext2D, text: string, font: string, max: number): string {
  context.font = font
  if (context.measureText(text).width <= max) return text
  let trimmed = text
  while (trimmed.length > 1 && context.measureText(`${trimmed}…`).width > max) {
    trimmed = trimmed.slice(0, -1)
  }
  return `${trimmed}…`
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** Normalises an angle difference into (-PI, PI] so spins take the short way. */
function shortestAngle(radians: number): number {
  return (((radians % TAU) + TAU + Math.PI) % TAU) - Math.PI
}
