import { useCallback, useEffect, useRef, useState } from 'react'
import type { Station } from '../lib/types'
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

/**
 * A stream served over http cannot be loaded by a page served over https, and
 * the browser reports it as an opaque media error. Catch it up front so we can
 * say what actually went wrong.
 */
function blockedByMixedContent(url: string): boolean {
  return window.location.protocol === 'https:' && url.startsWith('http://')
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

  if (!audioRef.current && typeof Audio !== 'undefined') {
    const audio = new Audio()
    audio.preload = 'none'
    audio.crossOrigin = 'anonymous'
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
      const failed = handlers.current.station
      setStatus('error')
      setError('Stream did not respond.')
      if (failed) handlers.current.onFailure(failed)
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
      setStation(next)
      setError(null)

      if (blockedByMixedContent(next.url)) {
        setStatus('error')
        setError('This station streams over plain http, which a secure page cannot load.')
        handlers.current.onFailure(next)
        return
      }

      setStatus('connecting')
      audio.src = next.url
      audio.load()
      void audio
        .play()
        .then(() => {
          reportClick(next.uuid)
          handlers.current.onPlay(next)
        })
        .catch((cause: unknown) => {
          // An autoplay rejection is the user's browser, not a dead stream, so
          // it must not trigger the skip-to-next-station path.
          if (cause instanceof DOMException && cause.name === 'NotAllowedError') {
            setStatus('paused')
            setError('Your browser blocked playback. Press play to start it.')
            return
          }
          setStatus('error')
          setError('Could not connect to this stream.')
          handlers.current.onFailure(next)
        })
    },
    [],
  )

  const toggle = useCallback(() => {
    const audio = audioRef.current
    if (!audio || !handlers.current.station) return
    if (audio.paused) {
      setStatus('connecting')
      // Live streams have no meaningful buffered position: reloading the source
      // rejoins the broadcast instead of resuming minutes-old audio.
      audio.load()
      void audio.play().catch(() => setStatus('paused'))
    } else {
      audio.pause()
    }
  }, [])

  const stop = useCallback(() => {
    const audio = audioRef.current
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
