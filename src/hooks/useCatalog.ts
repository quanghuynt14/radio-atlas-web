import { useCallback, useEffect, useRef, useState } from 'react'
import type { Station } from '../lib/types'
import { reachable } from '../lib/availability'
import { fetchByCountry, fetchGeolocated, searchStations } from '../lib/radioBrowser'
import { COUNTRY_TTL, WORLD_KEY, WORLD_TTL, countryKey, put, readFresh, readStale } from '../lib/cache'

const PAGE_SIZE = 500
const WORLD_PAGES = 8

export interface Catalog {
  /** Every station we know about this session, keyed by uuid. */
  stations: Map<string, Station>
  /** True while world pages are still streaming in. */
  loading: boolean
  loaded: number
  error: string | null
  /** Loads (or refreshes) one country and returns its stations, freshest first. */
  loadCountry: (code: string) => Promise<Station[]>
  /** Cached matches immediately, with directory results merged in when they land. */
  search: (term: string) => Promise<Station[]>
  remember: (stations: Station[]) => void
}

/**
 * The cache predates the reachability rule and outlives a move between http and
 * https, so rows coming back from it are filtered the way fresh ones are.
 */
function usable(rows: Station[] | null | undefined): Station[] {
  return rows ? rows.filter((station) => reachable(station.url)) : []
}

function merge(previous: Map<string, Station>, incoming: Station[]): Map<string, Station> {
  let changed = false
  const next = new Map(previous)
  for (const station of incoming) {
    const existing = next.get(station.uuid)
    // A row with real coordinates always beats one we only estimated.
    if (existing && !(existing.lat === null && station.lat !== null)) continue
    next.set(station.uuid, station)
    changed = true
  }
  return changed ? next : previous
}

export function useCatalog(): Catalog {
  const [stations, setStations] = useState<Map<string, Station>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const countryRequests = useRef(new Map<string, Promise<Station[]>>())

  const remember = useCallback((incoming: Station[]) => {
    setStations((current) => merge(current, incoming))
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadWorld() {
      const cached = usable(await readStale<Station[]>(WORLD_KEY))
      if (cached.length && !cancelled) {
        remember(cached)
        setLoading(false)
      }

      const fresh = await readFresh<Station[]>(WORLD_KEY, WORLD_TTL)
      if (fresh?.length) return

      const collected: Station[] = []
      for (let page = 0; page < WORLD_PAGES; page++) {
        if (cancelled) return
        try {
          const batch = await fetchGeolocated(PAGE_SIZE, page * PAGE_SIZE)
          if (cancelled) return
          collected.push(...batch)
          remember(batch)
          setError(null)
          // A short page means the directory has no more geolocated stations.
          if (batch.length < PAGE_SIZE) break
        } catch (cause) {
          if (!cached?.length) {
            setError(cause instanceof Error ? cause.message : 'Could not reach Radio Browser.')
          }
          break
        } finally {
          if (!cancelled) setLoading(false)
        }
      }
      if (!cancelled && collected.length) void put(WORLD_KEY, collected)
    }

    void loadWorld()
    return () => {
      cancelled = true
    }
  }, [remember])

  const loadCountry = useCallback(
    (rawCode: string) => {
      const code = rawCode.toUpperCase()
      const inflight = countryRequests.current.get(code)
      if (inflight) return inflight

      const request = (async () => {
        const key = countryKey(code)
        const cached = usable(await readFresh<Station[]>(key, COUNTRY_TTL))
        if (cached.length) {
          remember(cached)
          return cached
        }
        const stale = usable(await readStale<Station[]>(key))
        if (stale.length) remember(stale)
        try {
          const fresh = await fetchByCountry(code)
          if (fresh.length) {
            remember(fresh)
            void put(key, fresh)
            return fresh
          }
          return stale
        } catch {
          return stale
        } finally {
          countryRequests.current.delete(code)
        }
      })()

      countryRequests.current.set(code, request)
      return request
    },
    [remember],
  )

  const search = useCallback(
    async (term: string) => {
      const trimmed = term.trim()
      if (!trimmed) return []
      const results = await searchStations(trimmed)
      remember(results)
      return results
    },
    [remember],
  )

  return { stations, loading, loaded: stations.size, error, loadCountry, search, remember }
}
