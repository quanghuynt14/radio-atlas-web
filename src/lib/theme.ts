/**
 * Theme preference, resolved to a concrete light/dark value and stamped on
 * <html data-theme>. The globe reads its palette from CSS custom properties
 * and watches that attribute, so it is always set explicitly — 'system' is
 * resolved here rather than left to a bare media query.
 *
 * index.html stamps the same attribute inline before first paint; the storage
 * key below is duplicated there and the two must stay in step.
 */

export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

const KEY = 'radio-atlas:theme'
const SYSTEM_DARK = '(prefers-color-scheme: dark)'

/** Browser chrome colour, matched to --bg so the notch blends into the page. */
const CHROME: Record<Theme, string> = { dark: '#06090f', light: '#eef1f8' }

export function loadThemePreference(): ThemePreference {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw
  } catch {
    /* private mode costs the preference, not the session */
  }
  return 'system'
}

export function saveThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(KEY, preference)
  } catch {
    /* as above */
  }
}

export function resolveTheme(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference
  return window.matchMedia(SYSTEM_DARK).matches ? 'dark' : 'light'
}

export function applyTheme(preference: ThemePreference): Theme {
  const theme = resolveTheme(preference)
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', CHROME[theme])
  return theme
}

/** Fires while the preference is 'system' and the OS flips light/dark. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia(SYSTEM_DARK)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}
