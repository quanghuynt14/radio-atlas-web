/**
 * What this page can play, and what it has learned cannot.
 *
 * The directory's own `hidebroken` filter runs from a server, so it says
 * nothing about the two ways a stream dies in a browser: a page served over
 * https cannot load a stream served over plain http, and roughly a third of
 * the directory still streams that way. Offering those is offering a dead end
 * — the listener clicks, the player says "off air", and something else starts
 * playing instead.
 *
 * So streams this page provably cannot reach never enter the catalog, and the
 * ones that turn out to be dead are remembered for a few days. Not forever: a
 * station off the air today is often back next week.
 */
import type { Station } from './types'

const KEY = 'radio-atlas:off-air:v1'
/** How long a failure is held against a station. */
const TTL = 3 * 24 * 60 * 60 * 1000
const MAX_ENTRIES = 500

/** uuid to the time its stream last failed here. */
export type OffAir = Record<string, number>

/**
 * Whether this page could load the stream at all. A page served over https can
 * only load https; over http — a local dev server — everything is allowed.
 */
export function reachable(url: string): boolean {
  if (typeof window === 'undefined') return true
  if (window.location.protocol !== 'https:') return true
  return !/^http:\/\//i.test(url)
}

export function loadOffAir(): OffAir {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const cutoff = Date.now() - TTL
    const out: OffAir = {}
    for (const [uuid, at] of Object.entries(parsed)) {
      const when = Number(at)
      if (Number.isFinite(when) && when > cutoff) out[uuid] = when
    }
    return out
  } catch {
    return {}
  }
}

function save(register: OffAir): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(register))
  } catch {
    /* private mode or a full quota costs the memory, not the session */
  }
}

/** Records a failure, forgetting the oldest once the register is full. */
export function rememberOffAir(register: OffAir, uuid: string): OffAir {
  const next: OffAir = { ...register, [uuid]: Date.now() }
  const uuids = Object.keys(next)
  if (uuids.length > MAX_ENTRIES) {
    uuids.sort((a, b) => next[a] - next[b])
    for (const stale of uuids.slice(0, uuids.length - MAX_ENTRIES)) delete next[stale]
  }
  save(next)
  return next
}

/** Clears the mark, for when a station is played again on purpose. */
export function forgetOffAir(register: OffAir, uuid: string): OffAir {
  if (!(uuid in register)) return register
  const next = { ...register }
  delete next[uuid]
  save(next)
  return next
}

export function isOffAir(register: OffAir, station: Station): boolean {
  return station.uuid in register
}

/** Everything that has to be true for a station to be worth offering. */
export function playable(register: OffAir, station: Station): boolean {
  return reachable(station.url) && !isOffAir(register, station)
}

/**
 * Why a station cannot be played, in words for the listener, or null when it
 * can. The two cases are not the same: one is a stream that is down and worth
 * another try later, the other can never work from this page at all.
 */
export function blockedReason(register: OffAir, station: Station): string | null {
  if (!reachable(station.url)) return 'Insecure stream — a secure page cannot load it'
  if (isOffAir(register, station)) return 'Off air here — tap to try again'
  return null
}
