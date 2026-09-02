import type { PointerEvent as ReactPointerEvent } from 'react'
import Icon from './Icon'
import type { Player as PlayerState } from '../hooks/usePlayer'
import type { Station } from '../lib/types'

interface Props {
  player: PlayerState
  isFavourite: boolean
  onToggleFavourite: (station: Station) => void
  onRandom: () => void
}

const STATUS_LABEL: Record<PlayerState['status'], string> = {
  idle: 'Nothing playing',
  connecting: 'Tuning',
  playing: 'On air',
  paused: 'Paused',
  error: 'Off air',
}

export default function Player({ player, isFavourite, onToggleFavourite, onRandom }: Props) {
  const { station, status } = player
  const busy = status === 'connecting'
  const live = status === 'playing' || busy
  const volumeIcon = player.muted || player.volume === 0 ? 'volumeOff' : player.volume < 0.5 ? 'volumeLow' : 'volume'

  return (
    <section className="player" aria-label="Player">
      <div className="player-identity">
        <span className={`status status-${status}`}>
          <span className="status-dot" aria-hidden="true" />
          {STATUS_LABEL[status]}
        </span>
        <h2 className="player-name" title={station?.name}>
          {station ? station.name : 'Nothing tuned in'}
        </h2>
        <p className="player-sub">
          {station ? (
            <>
              <span className="truncate">
                {[station.country, station.tags.slice(0, 2).join(', ')].filter(Boolean).join(' · ') || 'Live stream'}
              </span>
              {station.homepage ? (
                <a
                  className="player-link"
                  href={station.homepage}
                  target="_blank"
                  rel="noreferrer noopener"
                  title="Open the station's website"
                  aria-label={`Open the website for ${station.name}`}
                >
                  <Icon name="link" size={13} />
                </a>
              ) : null}
            </>
          ) : (
            <span className="truncate">Pick a signal, or shuffle for a surprise.</span>
          )}
        </p>
        {player.error ? <p className="player-error">{player.error}</p> : null}
      </div>

      <div className="player-actions">
        <button type="button" className="control" onClick={onRandom} title="Shuffle to a random station (R)" aria-label="Shuffle to a random station">
          <Icon name="shuffle" />
        </button>
        <button
          type="button"
          className={isFavourite ? 'control is-on' : 'control'}
          onClick={() => station && onToggleFavourite(station)}
          disabled={!station}
          title="Favourite this station (F)"
          aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}
          aria-pressed={isFavourite}
        >
          <Icon name={isFavourite ? 'starFilled' : 'star'} />
        </button>
        <button
          type="button"
          className="control control-primary"
          onClick={player.toggle}
          disabled={!station}
          title="Play or pause (Space)"
          aria-label={live ? 'Pause' : 'Play'}
        >
          <Icon name={live ? 'pause' : 'play'} size={20} />
        </button>
      </div>

      <div className="player-volume">
        <button
          type="button"
          className="control control-quiet"
          onClick={player.toggleMute}
          title="Mute or unmute (M)"
          aria-label={player.muted ? 'Unmute' : 'Mute'}
          aria-pressed={player.muted}
        >
          <Icon name={volumeIcon} size={17} />
        </button>
        <input
          className="volume-slider"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={player.muted ? 0 : player.volume}
          onChange={(event) => player.setVolume(Number(event.target.value))}
          aria-label="Volume"
        />
        <button
          type="button"
          className="control control-quiet"
          onClick={player.stop}
          disabled={!station}
          title="Stop"
          aria-label="Stop"
        >
          <Icon name="stop" size={15} />
        </button>
      </div>
    </section>
  )
}

interface MiniProps {
  player: PlayerState
  onOpen: () => void
  onGrab: (event: ReactPointerEvent<HTMLElement>) => void
}

/**
 * The handheld resting state: one bar above the globe with what is on air and
 * a play button, doubling as the handle that drags the full sheet up.
 */
export function MiniPlayer({ player, onOpen, onGrab }: MiniProps) {
  const { station, status } = player
  const live = status === 'playing' || status === 'connecting'

  return (
    <div className="mini" onPointerDown={onGrab}>
      <span className="grabber-bar" aria-hidden="true" />
      <div className="mini-row">
        <button type="button" className="mini-body" onClick={onOpen} aria-label="Open the station list">
          <span className="mini-name">{station ? station.name : 'Nothing tuned in'}</span>
          <span className={`mini-meta status-${status}`}>
            <span className="status-dot" aria-hidden="true" />
            {station ? STATUS_LABEL[status] : 'Tap a country on the globe'}
          </span>
        </button>
        <button
          type="button"
          className="control control-primary"
          onClick={player.toggle}
          disabled={!station}
          aria-label={live ? 'Pause' : 'Play'}
        >
          <Icon name={live ? 'pause' : 'play'} size={20} />
        </button>
      </div>
    </div>
  )
}
