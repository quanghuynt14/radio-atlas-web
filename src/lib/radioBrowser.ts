import { reachable } from './availability'
import type { Station } from './types'

/**
 * Radio Browser mirrors. `all.api` round-robins across the pool; the named
 * mirrors are fallbacks for when it is unreachable. Browsers cannot set a
 * User-Agent, so unlike the desktop plugin we identify with a query parameter
 * the directory ignores but that shows up in their access logs.
 */
const MIRRORS = [
  'https://all.api.radio-browser.info',
  'https://de1.api.radio-browser.info',
  'https://at1.api.radio-browser.info',
  'https://nl1.api.radio-browser.info',
]

const CLIENT = 'radio-atlas-web/0.1.0'
const TIMEOUT_MS = 12_000

let preferred = 0

interface RawStation {
  stationuuid?: string
  name?: string
  url_resolved?: string
  url?: string
  homepage?: string
  favicon?: string
  country?: string
  countrycode?: string
  state?: string
  language?: string
  tags?: string
  codec?: string
  bitrate?: number
  votes?: number
  clickcount?: number
  geo_lat?: number | null
  geo_long?: number | null
  lastcheckok?: number
}

function finite(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Normalises a directory row and drops anything we cannot play or trust:
 * missing uuid, non-http(s) url, a stream this page could never load, or
 * coordinates outside the real range.
 */
function normalise(raw: RawStation): Station | null {
  const uuid = typeof raw.stationuuid === 'string' ? raw.stationuuid.trim() : ''
  const url = (raw.url_resolved || raw.url || '').trim()
  if (!uuid || !/^https?:\/\//i.test(url)) return null
  // An https page cannot load an http stream, so such a station is not a
  // station here — better absent than offered and instantly dead.
  if (!reachable(url)) return null

  const lat = finite(raw.geo_lat)
  const lon = finite(raw.geo_long)
  const hasGeo = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0)

  return {
    uuid,
    name: (raw.name || 'Unknown station').trim().slice(0, 120),
    url,
    homepage: (raw.homepage || '').trim(),
    favicon: (raw.favicon || '').trim(),
    country: (raw.country || '').trim(),
    countryCode: (raw.countrycode || '').trim().toUpperCase(),
    state: (raw.state || '').trim(),
    language: (raw.language || '').trim(),
    tags: (raw.tags || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8),
    codec: (raw.codec || '').trim(),
    bitrate: Number(raw.bitrate) || 0,
    votes: Number(raw.votes) || 0,
    clicks: Number(raw.clickcount) || 0,
    lat: hasGeo ? lat : null,
    lon: hasGeo ? lon : null,
    estimated: false,
  }
}

async function request<T>(path: string, params: Record<string, string | number | boolean> = {}): Promise<T> {
  const search = new URLSearchParams({ ...params, client: CLIENT } as Record<string, string>)
  let lastError: unknown

  for (let attempt = 0; attempt < MIRRORS.length; attempt++) {
    const base = MIRRORS[(preferred + attempt) % MIRRORS.length]
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
    try {
      const response = await fetch(`${base}${path}?${search}`, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
      const body = (await response.json()) as T
      preferred = (preferred + attempt) % MIRRORS.length
      return body
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timer)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Radio Browser unreachable')
}

async function stations(path: string, params: Record<string, string | number | boolean>): Promise<Station[]> {
  const rows = await request<RawStation[]>(path, params)
  if (!Array.isArray(rows)) return []
  const seen = new Set<string>()
  const out: Station[] = []
  for (const raw of rows) {
    const station = normalise(raw)
    if (!station || seen.has(station.uuid)) continue
    seen.add(station.uuid)
    out.push(station)
  }
  return out
}

/** One page of the most-played geolocated stations, for the world globe. */
export function fetchGeolocated(limit: number, offset: number): Promise<Station[]> {
  return stations('/json/stations/search', {
    has_geo_info: true,
    hidebroken: true,
    order: 'clickcount',
    reverse: true,
    limit,
    offset,
  })
}

/** Every playable station in one country, most played first. */
export function fetchByCountry(code: string, limit = 400): Promise<Station[]> {
  return stations(`/json/stations/bycountrycodeexact/${encodeURIComponent(code)}`, {
    hidebroken: true,
    order: 'clickcount',
    reverse: true,
    limit,
  })
}

/** Full-directory name search. */
export function searchStations(term: string, limit = 120): Promise<Station[]> {
  return stations('/json/stations/search', {
    name: term,
    hidebroken: true,
    order: 'clickcount',
    reverse: true,
    limit,
  })
}

/** A random playable station, biased towards ones that actually stream. */
export function fetchRandom(limit = 40): Promise<Station[]> {
  return stations('/json/stations/search', {
    hidebroken: true,
    order: 'random',
    limit,
  })
}

/**
 * Reports a play to the directory's click counter, the same courtesy call the
 * desktop plugin makes. Failures are ignored — it must never block playback.
 */
export function reportClick(uuid: string): void {
  void request(`/json/url/${encodeURIComponent(uuid)}`).catch(() => undefined)
}
