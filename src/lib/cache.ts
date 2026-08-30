import type { Station } from './types'

const DB_NAME = 'radio-atlas'
const DB_VERSION = 1
const STORE = 'cache'

interface Entry<T> {
  key: string
  savedAt: number
  value: T
}

let dbPromise: Promise<IDBDatabase | null> | null = null

function open(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

async function read<T>(key: string): Promise<Entry<T> | null> {
  const db = await open()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      request.onsuccess = () => resolve((request.result as Entry<T>) ?? null)
      request.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

async function write<T>(key: string, value: T): Promise<void> {
  const db = await open()
  if (!db) return
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put({ key, savedAt: Date.now(), value })
  } catch {
    /* a full or blocked store only costs us the cache, never correctness */
  }
}

/** Returns the cached value when it is younger than `maxAgeMs`, else null. */
export async function readFresh<T>(key: string, maxAgeMs: number): Promise<T | null> {
  const entry = await read<T>(key)
  if (!entry) return null
  return Date.now() - entry.savedAt <= maxAgeMs ? entry.value : null
}

/** Returns the cached value at any age, for instant paint before a refresh. */
export async function readStale<T>(key: string): Promise<T | null> {
  const entry = await read<T>(key)
  return entry ? entry.value : null
}

export const put = write

export const WORLD_KEY = 'world:v1'
export const countryKey = (code: string) => `country:${code.toUpperCase()}:v1`

export const WORLD_TTL = 12 * 60 * 60 * 1000
export const COUNTRY_TTL = 6 * 60 * 60 * 1000

export type StationCache = Station[]
