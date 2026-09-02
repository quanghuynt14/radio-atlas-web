import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Globe, { type GlobeHandle, type Placed } from './components/Globe'
import Icon, { type IconName } from './components/Icon'
import Player, { MiniPlayer } from './components/Player'
import StationList from './components/StationList'
import { useCatalog } from './hooks/useCatalog'
import { useMediaQuery } from './hooks/useMediaQuery'
import { usePlayer } from './hooks/usePlayer'
import { blockedReason, forgetOffAir, isOffAir, loadOffAir, playable, rememberOffAir } from './lib/availability'
import { countryName, estimateLocation, type Country } from './lib/countries'
import { fetchRandom } from './lib/radioBrowser'
import { loadState, pushHistory, saveState, toggleFavourite } from './lib/state'
import { applyTheme, loadThemePreference, saveThemePreference, watchSystemTheme, type ThemePreference } from './lib/theme'
import type { Station } from './lib/types'

type Tab = 'country' | 'search' | 'favourites' | 'history'
type Sheet = 'peek' | 'full'

/** How many dead streams to skip past before giving up on a list. */
const MAX_CONSECUTIVE_SKIPS = 5

/** Below this the panel becomes a bottom sheet over a full-bleed globe. */
const HANDHELD = '(max-width: 860px)'

const ZOOM_STEP = 1.4

const THEME_CYCLE: Record<ThemePreference, ThemePreference> = {
  system: 'light',
  light: 'dark',
  dark: 'system',
}

const THEME_ICON: Record<ThemePreference, IconName> = {
  system: 'monitor',
  light: 'sun',
  dark: 'moon',
}

const TABS: { id: Tab; icon: IconName; label: string }[] = [
  { id: 'country', icon: 'globe', label: 'Country' },
  { id: 'search', icon: 'search', label: 'Search' },
  { id: 'favourites', icon: 'star', label: 'Saved' },
  { id: 'history', icon: 'clock', label: 'Recent' },
]

export default function App() {
  const catalog = useCatalog()
  const initial = useRef(loadState()).current
  const handheld = useMediaQuery(HANDHELD)

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
  const [theme, setTheme] = useState<ThemePreference>(loadThemePreference)
  const [sheet, setSheet] = useState<Sheet>('peek')
  /** Stations whose stream failed here, so they stop being offered. */
  const [offAir, setOffAir] = useState(loadOffAir)
  /** The last station skipped past, so the jump to another one is explained. */
  const [skipped, setSkipped] = useState<string | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const globeRef = useRef<GlobeHandle>(null)
  const panelRef = useRef<HTMLElement>(null)
  const sheetRef = useRef(sheet)
  sheetRef.current = sheet
  const skips = useRef(0)
  const volumeRef = useRef({ volume: initial.volume, muted: initial.muted })

  const favouriteUuids = useMemo(() => new Set(favourites.map((s) => s.uuid)), [favourites])

  useEffect(() => {
    applyTheme(theme)
    saveThemePreference(theme)
    return watchSystemTheme(() => applyTheme(theme))
  }, [theme])

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
      // It played, so whatever we held against it no longer holds.
      setOffAir((current) => forgetOffAir(current, station.uuid))
      setHistory((current) => {
        const next = pushHistory(current, station)
        saveState({ favourites, history: next, volume: volumeRef.current.volume, muted: volumeRef.current.muted })
        return next
      })
    },
    onFailure: (station) => {
      // Remember it, so this dead end is not offered to anyone again for a few
      // days — the directory's own check cannot see what a browser refuses.
      setOffAir((current) => rememberOffAir(current, station.uuid))
      // Streams die quietly and often; walk down the visible list rather than
      // leaving the listener on a dead signal. Say so, though: silently landing
      // on a different station reads as a bug.
      if (skips.current >= MAX_CONSECUTIVE_SKIPS) return
      const list = activeListRef.current
      const index = list.findIndex((item) => item.uuid === station.uuid)
      const next = list.slice(index + 1).find((item) => playable(offAirRef.current, item))
      if (!next) return
      skips.current += 1
      setSkipped(station.name)
      setSelected(next)
      player.play(next)
    },
    onVolumeChange: (volume, muted) => {
      volumeRef.current = { volume, muted }
      saveState({ favourites, history, volume, muted })
    },
  })

  /**
   * Browsing only offers stations that can play. Saved and Recent show
   * everything — the listener put those there on purpose, and quietly deleting
   * them would be worse than marking them.
   */
  const activeList = useMemo(() => {
    if (tab === 'search') return results.filter((station) => playable(offAir, station))
    if (tab === 'favourites') return favourites
    if (tab === 'history') return history.map((entry) => entry.station)
    return countryStations.filter((station) => playable(offAir, station))
  }, [tab, results, favourites, history, countryStations, offAir])

  /** Rows on screen that cannot be played, and what to tell the listener. */
  const blocked = useMemo(() => {
    const notes = new Map<string, string>()
    for (const station of activeList) {
      const reason = blockedReason(offAir, station)
      if (reason) notes.set(station.uuid, reason)
    }
    return notes
  }, [activeList, offAir])

  const activeListRef = useRef(activeList)
  activeListRef.current = activeList

  const offAirRef = useRef(offAir)
  offAirRef.current = offAir

  /** Everything we can place on the globe, published coordinates or estimated. */
  const points = useMemo(() => {
    const placed: Placed[] = []
    for (const station of catalog.stations.values()) {
      if (isOffAir(offAir, station)) continue
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
  }, [catalog.stations, selectedCountry, offAir])

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
      // Asking for a country is asking to see its stations.
      setSheet('full')
    },
    [openCountry],
  )

  const playStation = useCallback(
    (station: Station) => {
      setSelected(station)
      setSkipped(null)
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

  /** Playing from the list is the end of browsing, so hand the globe back. */
  const playFromList = useCallback(
    (station: Station) => {
      playStation(station)
      setSheet('peek')
    },
    [playStation],
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

  const clearSearch = useCallback(() => {
    setTerm('')
    setResults([])
    searchRef.current?.focus()
  }, [])

  const tuneRandom = useCallback(async () => {
    const recent = new Set(history.slice(0, 25).map((entry) => entry.station.uuid))
    const pool = [...catalog.stations.values()].filter(
      (station) => !recent.has(station.uuid) && playable(offAir, station),
    )
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
  }, [catalog, history, offAir, playStation])

  // Keyboard control, matching the desktop plugin's bindings.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA'
      // Space and Enter belong to whatever control has focus; stealing them
      // would fire the button and the shortcut at once.
      const onControl = !!target?.closest('button, a, [role="button"]')

      if (event.key === 'Escape') {
        if (term) {
          setTerm('')
          setResults([])
        }
        searchRef.current?.blur()
        setSheet('peek')
        return
      }
      if (event.key === '/' && !typing) {
        event.preventDefault()
        setSheet('full')
        requestAnimationFrame(() => searchRef.current?.focus())
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
          if (!onControl && selected) playStation(selected)
          break
        case ' ':
          if (onControl) break
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

  // --- the bottom sheet ----------------------------------------------------
  // The drag writes transforms straight onto the element: re-rendering a list of
  // stations on every pointer move would drop frames on exactly the devices that
  // need them most. A drag that travelled also has to swallow the click it ends
  // with, or letting go would toggle the sheet straight back.
  const suppressClick = useRef(false)

  const dragSheet = useCallback((event: React.PointerEvent<HTMLElement>) => {
    const panel = panelRef.current
    if (!panel || event.button !== 0) return
    suppressClick.current = false

    const startY = event.clientY
    const height = panel.getBoundingClientRect().height
    const from = sheetRef.current === 'full' ? 0 : height
    let offset = from
    let moved = false

    const onMove = (move: PointerEvent) => {
      const delta = move.clientY - startY
      if (!moved && Math.abs(delta) > 4) {
        moved = true
        panel.dataset.dragging = 'true'
      }
      offset = Math.min(height, Math.max(0, from + delta))
      panel.style.transform = `translate3d(0, ${offset}px, 0)`
    }

    const release = () => {
      panel.style.transform = ''
      delete panel.dataset.dragging
    }

    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (!moved) {
        release()
        return
      }
      suppressClick.current = true
      setSheet(offset < height / 2 ? 'full' : 'peek')
      // Hand the transform back to CSS only once the new state is on the
      // element, or the sheet snaps to its old resting place for a frame.
      requestAnimationFrame(release)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [])

  /** Runs an action unless the pointer that ended on it had been dragging. */
  const guarded = useCallback((action: () => void) => () => {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    action()
  }, [])

  const busy = tab === 'search' ? searching : tab === 'country' ? countryLoading : false

  const emptyMessage =
    tab === 'search'
      ? searching
        ? 'Searching the directory…'
        : term
          ? 'No stations match that name.'
          : 'Search every station in the directory by name.'
      : tab === 'favourites'
        ? 'Star a station to keep it here.'
        : tab === 'history'
          ? 'Stations you play show up here.'
          : countryLoading
            ? 'Loading stations…'
            : countryStations.length
              ? 'Every station here is off air right now.'
              : `${handheld ? 'Tap' : 'Click'} a country on the globe to browse its stations.`

  const counts: Partial<Record<Tab, number>> = {
    favourites: favourites.length,
    history: history.length,
  }

  return (
    <div className="app" data-sheet={handheld ? sheet : undefined}>
      <main className="stage">
        <Globe
          ref={globeRef}
          points={points}
          selectedCountry={selectedCountry}
          playingUuid={player.station?.uuid ?? null}
          selectedUuid={selected?.uuid ?? null}
          focus={focus}
          onPickStation={playStation}
          onPickCountry={onPickCountry}
        />

        <div className="stage-top">
          <p className="brand">
            <Icon name="broadcast" size={17} />
            <span>Radio Atlas</span>
          </p>
          <button
            type="button"
            className="ghost"
            onClick={() => setTheme(THEME_CYCLE[theme])}
            title={`Theme: ${theme}`}
            aria-label={`Theme: ${theme}. Switch to ${THEME_CYCLE[theme]}.`}
          >
            <Icon name={THEME_ICON[theme]} size={17} />
          </button>
        </div>

        <div className="stage-foot">
          <p className="stage-status">
            {catalog.error ? (
              <span className="warn">{catalog.error}</span>
            ) : (
              <>
                <span className="stage-count">{catalog.loaded.toLocaleString()}</span> stations
                {catalog.loading ? <span className="stage-more"> · loading</span> : null}
              </>
            )}
          </p>
          <div className="zoom" role="group" aria-label="Zoom">
            <button type="button" className="ghost" onClick={() => globeRef.current?.zoomBy(ZOOM_STEP)} aria-label="Zoom in">
              <Icon name="plus" size={16} />
            </button>
            <button type="button" className="ghost" onClick={() => globeRef.current?.resetZoom()} aria-label="Reset zoom">
              <Icon name="target" size={16} />
            </button>
            <button type="button" className="ghost" onClick={() => globeRef.current?.zoomBy(1 / ZOOM_STEP)} aria-label="Zoom out">
              <Icon name="minus" size={16} />
            </button>
          </div>
        </div>
      </main>

      {handheld ? (
        <button type="button" className="scrim" tabIndex={-1} aria-label="Close the station list" onClick={() => setSheet('peek')} />
      ) : null}

      <aside className="panel" ref={panelRef}>
        {handheld ? (
          <button
            type="button"
            className="grabber"
            onPointerDown={dragSheet}
            onClick={guarded(() => setSheet('peek'))}
            aria-expanded={sheet === 'full'}
            aria-label="Collapse the station list"
          >
            <span className="grabber-bar" />
          </button>
        ) : null}

        <header className="panel-head">
          <div className="search-field">
            <Icon name="search" size={16} className="search-icon" />
            <input
              ref={searchRef}
              className="search"
              type="search"
              enterKeyHint="search"
              placeholder={handheld ? 'Search stations' : 'Search stations  ( / )'}
              value={term}
              onFocus={() => setSheet('full')}
              onChange={(event) => void runSearch(event.target.value)}
            />
            {term ? (
              <button type="button" className="search-clear" onClick={clearSearch} aria-label="Clear search">
                <Icon name="close" size={14} />
              </button>
            ) : null}
          </div>

          <nav className="tabs" aria-label="Station lists">
            {TABS.map(({ id, icon, label }) => (
              <button
                key={id}
                type="button"
                className={tab === id ? 'tab is-active' : 'tab'}
                aria-current={tab === id ? 'page' : undefined}
                onClick={() => setTab(id)}
              >
                <Icon name={id === 'favourites' && favourites.length ? 'starFilled' : icon} size={14} />
                <span className="tab-label">
                  {id === 'country' && selectedCountry ? countryName(selectedCountry) : label}
                </span>
                {counts[id] ? <span className="tab-count">{counts[id]}</span> : null}
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
            blocked={blocked}
            emptyMessage={emptyMessage}
            busy={busy}
            onPlay={playFromList}
            onToggleFavourite={onToggleFavourite}
          />
        </div>

        <Player
          player={player}
          isFavourite={!!player.station && favouriteUuids.has(player.station.uuid)}
          skipped={skipped}
          onToggleFavourite={onToggleFavourite}
          onRandom={() => void tuneRandom()}
        />
      </aside>

      {handheld ? <MiniPlayer player={player} onOpen={guarded(() => setSheet('full'))} onGrab={dragSheet} /> : null}
    </div>
  )
}
