import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import type { Station } from '../lib/types'

interface Props {
  stations: Station[]
  /**
   * Which list this is (tab, country, search, sort). The array itself is
   * rebuilt whenever a favourite or a play changes, which is not a new list.
   */
  listKey: string
  selectedUuid: string | null
  playingUuid: string | null
  favouriteUuids: Set<string>
  /** Rows that cannot be played, mapped to what to say about them. */
  blocked: Map<string, string>
  emptyMessage: string
  busy: boolean
  onPlay: (station: Station) => void
  onToggleFavourite: (station: Station) => void
}

/** A country can hold thousands of stations; reveal them a screenful at a time. */
const PAGE = 120

function describe(station: Station): string {
  return [station.country, station.state, station.codec, station.bitrate ? `${station.bitrate} kbps` : '']
    .filter(Boolean)
    .join(' · ')
}

export default function StationList({
  stations,
  listKey,
  selectedUuid,
  playingUuid,
  favouriteUuids,
  blocked,
  emptyMessage,
  busy,
  onPlay,
  onToggleFavourite,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null)
  const sentinelRef = useRef<HTMLLIElement>(null)
  const [limit, setLimit] = useState(PAGE)

  // A different list starts again from the top of the first page. Starring or
  // playing only rebuilds the same list, and must not throw away the scroll.
  useEffect(() => {
    setLimit(PAGE)
  }, [listKey])

  // Keyboard navigation can move the selection past the rendered rows; render
  // up to it, so the row exists to scroll to.
  const selectedIndex = selectedUuid ? stations.findIndex((station) => station.uuid === selectedUuid) : -1
  const needed = selectedIndex >= limit ? Math.ceil((selectedIndex + 1) / PAGE) * PAGE : limit
  if (needed !== limit) setLimit(needed)

  // Keyboard navigation moves the selection, so the selected row has to follow.
  useEffect(() => {
    if (!selectedUuid) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-uuid="${CSS.escape(selectedUuid)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedUuid, limit])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setLimit((current) => current + PAGE)
    })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [limit, stations])

  if (!stations.length) {
    return (
      <div className="empty">
        {busy ? <span className="spinner" aria-hidden="true" /> : null}
        <p>{emptyMessage}</p>
      </div>
    )
  }

  const visible = stations.slice(0, limit)

  return (
    <ul className="stations" ref={listRef}>
      {visible.map((station) => {
        const isFavourite = favouriteUuids.has(station.uuid)
        const isPlaying = station.uuid === playingUuid
        const blockedNote = blocked.get(station.uuid)
        return (
          <li
            key={station.uuid}
            data-uuid={station.uuid}
            className={[
              'station',
              station.uuid === selectedUuid ? 'is-selected' : '',
              isPlaying ? 'is-playing' : '',
              blockedNote ? 'is-off-air' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {/* One tap plays. Selecting without playing is what the arrow keys are for. */}
            <button
              type="button"
              className="station-main"
              aria-current={isPlaying ? 'true' : undefined}
              onClick={() => onPlay(station)}
            >
              <span className="station-badge" aria-hidden="true">
                {isPlaying ? (
                  <span className="bars">
                    <i />
                    <i />
                    <i />
                  </span>
                ) : (
                  <Icon name="play" size={13} />
                )}
              </span>
              <span className="station-text">
                <span className="station-name">{station.name}</span>
                <span className="station-meta">
                  {blockedNote ?? (describe(station) || 'Live stream')}
                </span>
              </span>
            </button>
            <button
              type="button"
              className={isFavourite ? 'icon is-on' : 'icon'}
              title={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
              aria-label={isFavourite ? `Unfavourite ${station.name}` : `Favourite ${station.name}`}
              aria-pressed={isFavourite}
              onClick={() => onToggleFavourite(station)}
            >
              <Icon name={isFavourite ? 'starFilled' : 'star'} size={17} />
            </button>
          </li>
        )
      })}
      {visible.length < stations.length ? (
        <li className="station-more" ref={sentinelRef}>
          <span className="spinner" aria-hidden="true" />
          {(stations.length - visible.length).toLocaleString()} more
        </li>
      ) : null}
    </ul>
  )
}
