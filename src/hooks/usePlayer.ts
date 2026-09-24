import { useCallback, useEffect, useRef, useState } from 'react'
import type { Station } from '../lib/types'
import { reachable } from '../lib/availability'
import { reportClick } from '../lib/radioBrowser'

export type PlayerStatus = 'idle' | 'connecting' | 'playing' | 'paused' | 'error'

export interface Player {
  station: Station | null
  status: PlayerStatus
  error: string | null
  volume: number
  muted: boolean
  play: (station: Station) => void
  toggle: () => void
  stop: () => void
  setVolume: (value: number) => void
  toggleMute: () => void
}

interface Options {
  initialVolume: number
  initialMuted: boolean
  onPlay: (station: Station) => void
  onFailure: (station: Station) => void
  onVolumeChange: (volume: number, muted: boolean) => void
}

export function usePlayer({ initialVolume, initialMuted, onPlay, onFailure, onVolumeChange }: Options): Player {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [station, setStation] = useState<Station | null>(null)
  const [status, setStatus] = useState<PlayerStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [volume, setVolumeState] = useState(initialVolume)
  const [muted, setMuted] = useState(initialMuted)

  // Callbacks live in a ref so the audio element's listeners are attached once
  // and never see a stale closure over the current station.
  const handlers = useRef({ onPlay, onFailure, station })
  handlers.current = { onPlay, onFailure, station }

  /**
   * Each start of playback is an attempt. A dead stream reports itself twice
   * (the element's `error` event and the rejected `play()`), and switching
   * station or stopping mid-connect rejects the old attempt's `play()` with an
   * AbortError. Only the current attempt may report a failure, and only once;
   * without that, one dead station set off a chain of skips that marked
   * healthy ones off-air too.
   */
  const attempt = useRef({ id: 0, station: null as Station | null, reported: false })

  const begin = (next: Station | null) => {
    attempt.current = { id: attempt.current.id + 1, station: next, reported: false }
    return attempt.current.id
  }

  /** Reports the current attempt's station as failed, at most once. */
  const fail = (id: number, message: string) => {
    const current = attempt.current
    if (current.id !== id || current.reported || !current.station) return
    current.reported = true
    setStatus('error')
    setError(message)
    handlers.current.onFailure(current.station)
  }

  if (!audioRef.current && typeof Audio !== 'undefined') {
    // No crossOrigin: nothing reads the audio through WebAudio, and asking for
    // CORS made browsers refuse every stream whose server doesn't send the
    // headers — healthy stations, then marked off-air for days.
    const audio = new Audio()
    audio.preload = 'none'
    audioRef.current = audio
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onPlaying = () => {
      setStatus('playing')
      setError(null)
    }
    const onWaiting = () => setStatus((current) => (current === 'playing' ? 'connecting' : current))
    const onPause = () => setStatus((current) => (current === 'idle' ? current : 'paused'))
    const onAudioError = () => {
      // Stop empties the source, which is not a stream failing.
      if (!audio.getAttribute('src')) return
      fail(attempt.current.id, 'Stream did not respond.')
    }

    audio.addEventListener('playing', onPlaying)
    audio.addEventListener('waiting', onWaiting)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('error', onAudioError)
    audio.addEventListener('stalled', onWaiting)
    return () => {
      audio.removeEventListener('playing', onPlaying)
      audio.removeEventListener('waiting', onWaiting)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('error', onAudioError)
      audio.removeEventListener('stalled', onWaiting)
      audio.pause()
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.volume = volume
    audio.muted = muted
  }, [volume, muted])

  const play = useCallback(
    (next: Station) => {
      const audio = audioRef.current
      if (!audio) return
      const id = begin(next)
      setStation(next)
      setError(null)

      // http streams are filtered out of the catalog, but a favourite saved
      // before that rule can still reach here. Say what is wrong rather than
      // letting the browser report an opaque media error.
      if (!reachable(next.url)) {
        fail(id, 'This station streams over plain http, which is not played here.')
        return
      }

      setStatus('connecting')
      audio.src = next.url
      audio.load()
      void audio
        .play()
        .then(() => {
          if (attempt.current.id !== id) return
          reportClick(next.uuid)
          handlers.current.onPlay(next)
        })
        .catch((cause: unknown) => {
          // Superseded by another station or by Stop: not this stream's fault.
          if (attempt.current.id !== id) return
          const name = cause instanceof DOMException ? cause.name : ''
          if (name === 'AbortError') return
          // An autoplay rejection is the user's browser, not a dead stream, so
          // it must not trigger the skip-to-next-station path.
          if (name === 'NotAllowedError') {
            setStatus('paused')
            setError('Your browser blocked playback. Press play to start it.')
            return
          }
          fail(id, 'Could not connect to this stream.')
        })
    },
    // begin and fail only touch refs and state setters.
    [],
  )

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !handlers.current.station) return
    if (audio.paused) {
      const id = begin(handlers.current.station)
      setStatus('connecting')
      // Live streams have no meaningful buffered position: reloading the source
      // rejoins the broadcast instead of resuming minutes-old audio.
      audio.load()
      void audio.play().catch(() => {
        if (attempt.current.id === id && !attempt.current.reported) setStatus('paused')
      })
    } else {
      audio.pause()
    }
  }, [])

  const stop = useCallback(() => {
    const audio = audioRef.current
    begin(null)
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
    }
    setStation(null)
    setStatus('idle')
    setError(null)
  }, [])

  const setVolume = useCallback(
    (value: number) => {
      const clamped = Math.min(1, Math.max(0, value))
      // Nudging the slider up is also how you unmute.
      const nextMuted = clamped === 0 ? muted : false
      setVolumeState(clamped)
      setMuted(nextMuted)
      onVolumeChange(clamped, nextMuted)
    },
    [muted, onVolumeChange],
  )

  const toggleMute = useCallback(() => {
    const next = !muted
    setMuted(next)
    onVolumeChange(volume, next)
  }, [muted, onVolumeChange, volume])

  return { station, status, error, volume, muted, play, toggle, stop, setVolume, toggleMute }
}
