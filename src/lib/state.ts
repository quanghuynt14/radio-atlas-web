import type { HistoryEntry, Station } from './types'

const KEY = 'radio-atlas:state:v1'
const MAX_FAVOURITES = 300
const MAX_HISTORY = 100

export interface PersistedState {
  favourites: Station[]
  history: HistoryEntry[]
  volume: number
  muted: boolean
}

export const emptyState: PersistedState = {
  favourites: [],
  history: [],
  volume: 0.7,
  muted: false,
}

function isStation(value: unknown): value is Station {
  const s = value as Station | null
  return !!s && typeof s.uuid === 'string' && typeof s.url === 'string' && typeof s.name === 'string'
}

/**
 * Reads saved state, refusing anything malformed rather than crashing the app —
 * the desktop plugin has the same rule about not trusting its own state file.
 */
export function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyState
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    const volume = Number(parsed.volume)
    return {
      favourites: Array.isArray(parsed.favourites) ? parsed.favourites.filter(isStation).slice(0, MAX_FAVOURITES) : [],
      history: Array.isArray(parsed.history)
        ? parsed.history.filter((e) => isStation((e as HistoryEntry)?.station)).slice(0, MAX_HISTORY)
        : [],
      volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : emptyState.volume,
      muted: Boolean(parsed.muted),
    }
  } catch {
    return emptyState
  }
}

export function saveState(state: PersistedState): void {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        favourites: state.favourites.slice(0, MAX_FAVOURITES),
        history: state.history.slice(0, MAX_HISTORY),
        volume: state.volume,
        muted: state.muted,
      }),
    )
  } catch {
    /* private mode or a full quota costs persistence, not the session */
  }
}

export function toggleFavourite(favourites: Station[], station: Station): Station[] {
  const without = favourites.filter((s) => s.uuid !== station.uuid)
  if (without.length !== favourites.length) return without
  return [station, ...without].slice(0, MAX_FAVOURITES)
}

export function pushHistory(history: HistoryEntry[], station: Station): HistoryEntry[] {
  const without = history.filter((entry) => entry.station.uuid !== station.uuid)
  return [{ station, playedAt: Date.now() }, ...without].slice(0, MAX_HISTORY)
}
