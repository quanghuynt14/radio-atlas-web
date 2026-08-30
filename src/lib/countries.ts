import { geoCentroid, geoContains } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { Topology, GeometryCollection } from 'topojson-specification'
import meta from './countryMeta.json'

interface CountryMeta {
  code: string
  name: string
  lat: number
  lon: number
}

/** Keyed by ISO 3166-1 numeric, which is what Natural Earth topojson ids use. */
const byNumeric = meta as Record<string, CountryMeta>

export interface Country {
  /** ISO 3166-1 alpha-2 — the code Radio Browser indexes stations by. */
  code: string
  name: string
  lat: number
  lon: number
  feature: Feature<Geometry>
}

let loaded: Promise<{ countries: Country[]; land: FeatureCollection }> | null = null

/**
 * Loads Natural Earth country outlines once and joins them to ISO alpha-2
 * codes. Anything we cannot map to a code stays in `land` so it still draws,
 * it just is not clickable as a country.
 */
export function loadCountries() {
  if (loaded) return loaded
  loaded = fetch(`${import.meta.env.BASE_URL}data/countries-110m.json`)
    .then((response) => {
      if (!response.ok) throw new Error(`map data ${response.status}`)
      return response.json() as Promise<Topology<{ countries: GeometryCollection }>>
    })
    .then((topology) => {
      const collection = feature(topology, topology.objects.countries) as FeatureCollection
      const countries: Country[] = []
      for (const item of collection.features) {
        const info = byNumeric[String(item.id ?? '')]
        if (!info) continue
        const centroid = geoCentroid(item)
        const usable = Number.isFinite(centroid[0]) && Number.isFinite(centroid[1])
        countries.push({
          code: info.code,
          name: info.name,
          lon: usable ? centroid[0] : info.lon,
          lat: usable ? centroid[1] : info.lat,
          feature: item,
        })
      }
      return { countries, land: collection }
    })
  return loaded
}

/** The country whose polygon contains this point, or null over open water. */
export function countryAt(countries: Country[], lon: number, lat: number): Country | null {
  for (const country of countries) {
    if (geoContains(country.feature, [lon, lat])) return country
  }
  return null
}

const centroidByCode = new Map<string, CountryMeta>()
for (const info of Object.values(byNumeric)) centroidByCode.set(info.code, info)

/**
 * Where to draw a station that publishes no coordinates: its country's
 * centroid, jittered deterministically by uuid so a country's unlocated
 * stations spread into a cluster instead of stacking on one pixel.
 */
export function estimateLocation(countryCode: string, uuid: string): { lat: number; lon: number } | null {
  const info = centroidByCode.get(countryCode.toUpperCase())
  if (!info) return null
  let hash = 0
  for (let i = 0; i < uuid.length; i++) hash = (hash * 31 + uuid.charCodeAt(i)) | 0
  const angle = ((hash >>> 0) % 360) * (Math.PI / 180)
  const radius = 0.4 + (((hash >>> 9) % 100) / 100) * 1.6
  return {
    lat: Math.max(-85, Math.min(85, info.lat + Math.sin(angle) * radius)),
    lon: info.lon + (Math.cos(angle) * radius) / Math.max(0.2, Math.cos((info.lat * Math.PI) / 180)),
  }
}

export function countryName(code: string): string {
  return centroidByCode.get(code.toUpperCase())?.name ?? code.toUpperCase()
}

export function countryCentre(code: string): { lat: number; lon: number } | null {
  const info = centroidByCode.get(code.toUpperCase())
  return info ? { lat: info.lat, lon: info.lon } : null
}
