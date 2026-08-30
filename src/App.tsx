import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Globe, { type Placed } from './components/Globe'
import Player from './components/Player'
import StationList from './components/StationList'
import { useCatalog } from './hooks/useCatalog'
import { usePlayer } from './hooks/usePlayer'
import { countryName, estimateLocation, type Country } from './lib/countries'
import { fetchRandom } from './lib/radioBrowser'
import { loadState, pushHistory, saveState, toggleFavourite } from './lib/state'
import type { Station } from './lib/types'

type Tab = 'country' | 'search' | 'favourites' | 'history'

/** How many dead streams to skip past before giving up on a list. */
const MAX_CONSECUTIVE_SKIPS = 5

export default function App() {
  const catalog = useCatalog()
  const initial = useRef(loadState()).current

  const [favourites, setFavourites] = useState(initial.favourites)
  const [history, setHistory] = useState(initial.history)
  const [tab, setTab] = useState<Tab>('country')
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null)
  const [countryStations, setCountryStations] = useState<Station[]>([])
  const [countryLoading, setCountryLoading] = useState(false)
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<Station[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Station | null>(null)
  const [focus, setFocus] = useState<{ lat: number; lon: number } | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const skips = useRef(0)
  const volumeRef = useRef({ volume: initial.volume, muted: initial.muted })

  const favouriteUuids = useMemo(() => new Set(favourites.map((s) => s.uuid)), [favourites])

  const persist = useCallback(
    (next: Partial<{ favourites: Station[]; history: typeof history }>) => {
      saveState({
        favourites: next.favourites ?? favourites,
        history: next.history ?? history,
        volume: volumeRef.current.volume,
        muted: volumeRef.current.muted,
      })
    },
    [favourites, history],
  )

  const player = usePlayer({
    initialVolume: initial.volume,
    initialMuted: initial.muted,
    onPlay: (station) => {
      skips.current = 0
      setHistory((current) => {
        const next = pushHistory(current, station)
        saveState({ favourites, history: next, volume: volumeRef.current.volume, muted: volumeRef.current.muted })
        return next
      })
    },
    onFailure: (station) => {
      // Streams die quietly and often; walk down the visible list rather than
      // leaving the listener on a dead signal.
      if (skips.current >= MAX_CONSECUTIVE_SKIPS) return
      const list = activeListRef.current
      const index = list.findIndex((item) => item.uuid === station.uuid)
      const next = index >= 0 ? list[index + 1] : undefined
      if (!next) return
      skips.current += 1
      setSelected(next)
      player.play(next)
    },
    onVolumeChange: (volume, muted) => {
      volumeRef.current = { volume, muted }
      saveState({ favourites, history, volume, muted })
    },
  })

  const activeList = useMemo(() => {
    if (tab === 'search') return results
    if (tab === 'favourites') return favourites
    if (tab === 'history') return history.map((entry) => entry.station)
    return countryStations
  }, [tab, results, favourites, history, countryStations])

  const activeListRef = useRef(activeList)
  activeListRef.current = activeList

  /** Everything we can place on the globe, published coordinates or estimated. */
  const points = useMemo(() => {
    const placed: Placed[] = []
    for (const station of catalog.stations.values()) {
      const session = !!selectedCountry && station.countryCode === selectedCountry
      if (station.lat !== null && station.lon !== null) {
        placed.push({ station, lat: station.lat, lon: station.lon, session })
        continue
      }
      // Unlocated stations are only worth drawing for the country in focus,
      // otherwise thousands of guesses would swamp the real signals.
      if (!session || !station.countryCode) continue
      const estimate = estimateLocation(station.countryCode, station.uuid)
      if (estimate) placed.push({ station, lat: estimate.lat, lon: estimate.lon, session })
    }
    return placed
  }, [catalog.stations, selectedCountry])

  const openCountry = useCallback(
    async (code: string, centre?: { lat: number; lon: number }) => {
      setSelectedCountry(code)
      setTab('country')
      setCountryLoading(true)
      if (centre) setFocus({ ...centre })
      try {
        const stations = await catalog.loadCountry(code)
        setCountryStations(stations)
      } finally {
        setCountryLoading(false)
      }
    },
    [catalog],
  )

  const onPickCountry = useCallback(
    (country: Country) => {
      void openCountry(country.code, { lat: country.lat, lon: country.lon })
    },
    [openCountry],
  )

  const playStation = useCallback(
    (station: Station) => {
      setSelected(station)
      skips.current = 0
      player.play(station)
      if (station.lat !== null && station.lon !== null) {
        setFocus({ lat: station.lat, lon: station.lon })
      } else if (station.countryCode) {
        const estimate = estimateLocation(station.countryCode, station.uuid)
        if (estimate) setFocus(estimate)
      }
      // The station that is playing should have its country browsable.
      if (station.countryCode && station.countryCode !== selectedCountry) {
        void catalog.loadCountry(station.countryCode).then(setCountryStations)
        setSelectedCountry(station.countryCode)
      }
    },
    [catalog, player, selectedCountry],
  )

  const onToggleFavourite = useCallback(
    (station: Station) => {
      setFavourites((current) => {
        const next = toggleFavourite(current, station)
        persist({ favourites: next })
        return next
      })
    },
    [persist],
  )

  const runSearch = useCallback(
    async (value: string) => {
      const trimmed = value.trim()
      setTerm(value)
      if (!trimmed) {
        setResults([])
        return
      }
      setTab('search')
      // Cached matches paint immediately; the directory refresh replaces them.
      const lowered = trimmed.toLowerCase()
      const cached: Station[] = []
      for (const station of catalog.stations.values()) {
        if (station.name.toLowerCase().includes(lowered)) cached.push(station)
        if (cached.length >= 60) break
      }
      setResults(cached)
      setSearching(true)
      try {
        const remote = await catalog.search(trimmed)
        if (remote.length) setResults(remote)
      } finally {
        setSearching(false)
      }
    },
    [catalog],
  )

  const tuneRandom = useCallback(async () => {
    const recent = new Set(history.slice(0, 25).map((entry) => entry.station.uuid))
    const pool = [...catalog.stations.values()].filter((station) => !recent.has(station.uuid))
    if (pool.length) {
      playStation(pool[Math.floor(Math.random() * pool.length)])
      return
    }
    const remote = await fetchRandom()
    const pick = remote.find((station) => !recent.has(station.uuid)) ?? remote[0]
    if (pick) {
      catalog.remember(remote)
      playStation(pick)
    }
  }, [catalog, history, playStation])

  // Keyboard control, matching the desktop plugin's bindings.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'

      if (event.key === 'Escape') {
        if (term) {
          setTerm('')
          setResults([])
        }
        searchRef.current?.blur()
        return
      }
      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (typing) return

      const list = activeListRef.current
      const index = selected ? list.findIndex((item) => item.uuid === selected.uuid) : -1

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault()
          if (list.length) setSelected(list[Math.min(list.length - 1, index + 1)])
          break
        case 'ArrowUp':
          event.preventDefault()
          if (list.length) setSelected(list[Math.max(0, index - 1)])
          break
        case 'Enter':
          if (selected) playStation(selected)
          break
        case ' ':
          event.preventDefault()
          player.toggle()
          break
        case 'r':
        case 'R':
          void tuneRandom()
          break
        case 'f':
        case 'F':
          if (selected) onToggleFavourite(selected)
          break
        case 'm':
        case 'M':
          player.toggleMute()
          break
        case '+':
        case '=':
          player.setVolume(player.volume + 0.05)
          break
        case '-':
        case '_':
          player.setVolume(player.volume - 0.05)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onToggleFavourite, player, playStation, selected, term, tuneRandom])

  const emptyMessage =
    tab === 'search'
      ? searching
        ? 'Searching the directory…'
        : term
          ? 'No stations match that name.'
          : 'Type to search every station in the directory.'
      : tab === 'favourites'
        ? 'Star a station to keep it here.'
        : tab === 'history'
          ? 'Stations you play show up here.'
          : countryLoading
            ? 'Loading stations…'
            : 'Click a country on the globe to browse its stations.'

  return (
    <div className="app">
      <main className="stage">
        <Globe
          points={points}
          selectedCountry={selectedCountry}
          playingUuid={player.station?.uuid ?? null}
          selectedUuid={selected?.uuid ?? null}
          focus={focus}
          onPickStation={playStation}
          onPickCountry={onPickCountry}
        />
        <div className="stage-status">
          {catalog.error ? (
            <span className="warn">{catalog.error}</span>
          ) : (
            <span>
              {catalog.loaded.toLocaleString()} stations
              {catalog.loading ? ' · loading more…' : ''}
            </span>
          )}
        </div>
      </main>

      <aside className="panel">
        <header className="panel-head">
          <h1>Radio Atlas</h1>
          <input
            ref={searchRef}
            className="search"
            type="search"
            placeholder="Search stations  ( / )"
            value={term}
            onChange={(event) => void runSearch(event.target.value)}
          />
          <nav className="tabs">
            {(['country', 'search', 'favourites', 'history'] as Tab[]).map((name) => (
              <button
                key={name}
                type="button"
                className={tab === name ? 'tab is-active' : 'tab'}
                onClick={() => setTab(name)}
              >
                {name === 'country' ? (selectedCountry ? countryName(selectedCountry) : 'Country') : name}
              </button>
            ))}
          </nav>
        </header>

        <div className="panel-list">
          <StationList
            stations={activeList}
            selectedUuid={selected?.uuid ?? null}
            playingUuid={player.station?.uuid ?? null}
            favouriteUuids={favouriteUuids}
            emptyMessage={emptyMessage}
            onSelect={setSelected}
            onPlay={playStation}
            onToggleFavourite={onToggleFavourite}
          />
        </div>

        <Player
          player={player}
          isFavourite={!!player.station && favouriteUuids.has(player.station.uuid)}
          onToggleFavourite={onToggleFavourite}
          onRandom={() => void tuneRandom()}
        />
      </aside>
    </div>
  )
}
