/**
 * The URL if it is a web address, else ''. Station homepages come from the
 * community-run directory, and a `javascript:` or `data:` one would otherwise
 * render as a clickable script link.
 */
export function webUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  try {
    const { protocol } = new URL(trimmed)
    return protocol === 'http:' || protocol === 'https:' ? trimmed : ''
  } catch {
    return ''
  }
}
