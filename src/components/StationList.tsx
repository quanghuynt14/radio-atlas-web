import { useEffect, useRef } from 'react'
import type { Station } from '../lib/types'

interface Props {
  stations: Station[]
  selectedUuid: string | null
  playingUuid: string | null
  favouriteUuids: Set<string>
  emptyMessage: string
  onSelect: (station: Station) => void
  onPlay: (station: Station) => void
  onToggleFavourite: (station: Station) => void
}

export default function StationList({
  stations,
  selectedUuid,
  playingUuid,
  favouriteUuids,
  emptyMessage,
  onSelect,
  onPlay,
  onToggleFavourite,
}: Props) {
  const listRef = useRef<HTMLUListElement>(null)

  // Keyboard navigation moves the selection, so the selected row has to follow.
  useEffect(() => {
    if (!selectedUuid) return
    const row = listRef.current?.querySelector<HTMLElement>(`[data-uuid="${CSS.escape(selectedUuid)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [selectedUuid])

  if (!stations.length) return <p className="empty">{emptyMessage}</p>

  return (
    <ul className="stations" ref={listRef}>
      {stations.map((station) => {
        const isFavourite = favouriteUuids.has(station.uuid)
        return (
          <li
            key={station.uuid}
            data-uuid={station.uuid}
            className={[
              'station',
              station.uuid === selectedUuid ? 'is-selected' : '',
              station.uuid === playingUuid ? 'is-playing' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <button
              type="button"
              className="station-main"
              onClick={() => onSelect(station)}
              onDoubleClick={() => onPlay(station)}
            >
              <span className="station-name">{station.name}</span>
              <span className="station-meta">
                {[station.country, station.state, station.codec, station.bitrate ? `${station.bitrate} kbps` : '']
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
            <div className="station-actions">
              <button
                type="button"
                className={isFavourite ? 'icon is-on' : 'icon'}
                title={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
                aria-label={isFavourite ? `Unfavourite ${station.name}` : `Favourite ${station.name}`}
                onClick={() => onToggleFavourite(station)}
              >
                {isFavourite ? '★' : '☆'}
              </button>
              <button
                type="button"
                className="icon"
                title="Play station"
                aria-label={`Play ${station.name}`}
                onClick={() => onPlay(station)}
              >
                ▶
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
