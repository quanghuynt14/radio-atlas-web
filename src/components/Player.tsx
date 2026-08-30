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
  connecting: 'Tuning…',
  playing: 'On air',
  paused: 'Paused',
  error: 'Off air',
}

export default function Player({ player, isFavourite, onToggleFavourite, onRandom }: Props) {
  const { station, status } = player

  return (
    <section className="player" aria-label="Player">
      <div className="player-identity">
        <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>
        <h2 className="player-name">{station ? station.name : 'Pick a signal on the globe'}</h2>
        <p className="player-sub">
          {station
            ? [station.country, station.tags.slice(0, 3).join(', ')].filter(Boolean).join(' · ') || 'Live stream'
            : 'Drag to rotate, scroll to zoom, click a country to browse.'}
        </p>
        {player.error ? <p className="player-error">{player.error}</p> : null}
      </div>

      <div className="player-controls">
        <button type="button" className="control" onClick={player.toggle} disabled={!station} title="Play or pause">
          {status === 'playing' || status === 'connecting' ? '❚❚' : '▶'}
        </button>
        <button type="button" className="control" onClick={player.stop} disabled={!station} title="Stop">
          ■
        </button>
        <button type="button" className="control" onClick={onRandom} title="Tune a random station (R)">
          ⤮
        </button>
        <button
          type="button"
          className={isFavourite ? 'control is-on' : 'control'}
          onClick={() => station && onToggleFavourite(station)}
          disabled={!station}
          title="Favourite this station (F)"
        >
          {isFavourite ? '★' : '☆'}
        </button>

        <div className="volume">
          <button
            type="button"
            className="control"
            onClick={player.toggleMute}
            title="Mute or unmute (M)"
            aria-label={player.muted ? 'Unmute' : 'Mute'}
          >
            {player.muted || player.volume === 0 ? '🔇' : '🔊'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={player.muted ? 0 : player.volume}
            onChange={(event) => player.setVolume(Number(event.target.value))}
            aria-label="Volume"
          />
        </div>
      </div>
    </section>
  )
}
