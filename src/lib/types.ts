export interface Station {
  /** Radio Browser station uuid — stable primary key. */
  uuid: string
  name: string
  /** Stream URL, already resolved through redirects by Radio Browser. */
  url: string
  homepage: string
  favicon: string
  country: string
  /** ISO 3166-1 alpha-2, uppercased. Empty when the directory has none. */
  countryCode: string
  state: string
  language: string
  tags: string[]
  codec: string
  bitrate: number
  votes: number
  clicks: number
  /** Published coordinates, or null when the station has none. */
  lat: number | null
  lon: number | null
  /** True when lat/lon were estimated from the country rather than published. */
  estimated: boolean
}

export interface HistoryEntry {
  station: Station
  playedAt: number
}
