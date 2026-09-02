import type { ReactNode } from 'react'

/**
 * One hand-drawn icon set on a 24px grid.
 *
 * The controls used to be typographic glyphs (▶ ❚❚ ★ 🔊), which each platform
 * renders at a different weight and some turn into colour emoji. Inline SVG
 * keeps every control the same shape and lets it inherit currentColor.
 */

const SOLID = { fill: 'currentColor', stroke: 'none' }

const ICONS = {
  play: <path d="M8 5.14v13.72L19 12z" {...SOLID} />,
  pause: (
    <>
      <rect x="7" y="5" width="3.4" height="14" rx="1.2" {...SOLID} />
      <rect x="13.6" y="5" width="3.4" height="14" rx="1.2" {...SOLID} />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2" {...SOLID} />,
  shuffle: (
    <>
      <path d="M16 3.5h4.5V8" />
      <path d="M3.5 20.5 20.5 3.5" />
      <path d="M20.5 16v4.5H16" />
      <path d="M14.8 14.8l5.7 5.7" />
      <path d="M3.5 3.5l5.7 5.7" />
    </>
  ),
  star: <path d="M12 3.8l2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.82l-5.1 2.68.97-5.68L3.75 9.8l5.7-.83z" />,
  starFilled: (
    <path d="M12 3.8l2.55 5.17 5.7.83-4.12 4.02.97 5.68L12 16.82l-5.1 2.68.97-5.68L3.75 9.8l5.7-.83z" {...SOLID} />
  ),
  volume: (
    <>
      <path d="M11 4.8 6.4 9H3.2v6h3.2L11 19.2z" />
      <path d="M15.2 9.2a4 4 0 0 1 0 5.6" />
      <path d="M18 6.4a8 8 0 0 1 0 11.2" />
    </>
  ),
  volumeLow: (
    <>
      <path d="M11 4.8 6.4 9H3.2v6h3.2L11 19.2z" />
      <path d="M15.2 9.2a4 4 0 0 1 0 5.6" />
    </>
  ),
  volumeOff: (
    <>
      <path d="M11 4.8 6.4 9H3.2v6h3.2L11 19.2z" />
      <path d="M15.5 9.5 21 15" />
      <path d="M21 9.5 15.5 15" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="M15.8 15.8 21 21" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M3.2 12h17.6" />
      <path d="M12 3.2a13.4 13.4 0 0 1 0 17.6 13.4 13.4 0 0 1 0-17.6z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.8" />
      <path d="M12 6.8V12l3.4 2" />
    </>
  ),
  broadcast: (
    <>
      <circle cx="12" cy="12" r="2.3" {...SOLID} />
      <path d="M8.4 8.4a5.1 5.1 0 0 0 0 7.2" />
      <path d="M15.6 8.4a5.1 5.1 0 0 1 0 7.2" />
      <path d="M5.6 5.6a9.1 9.1 0 0 0 0 12.8" />
      <path d="M18.4 5.6a9.1 9.1 0 0 1 0 12.8" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.5 1.5M17.1 17.1l1.5 1.5M18.6 5.4l-1.5 1.5M6.9 17.1l-1.5 1.5" />
    </>
  ),
  moon: <path d="M20.5 14.6A8.7 8.7 0 0 1 9.4 3.5a8.7 8.7 0 1 0 11.1 11.1z" />,
  monitor: (
    <>
      <rect x="2.8" y="4.2" width="18.4" height="12.6" rx="2.2" />
      <path d="M8.4 20.8h7.2M12 16.8v4" />
    </>
  ),
  plus: <path d="M12 5.4v13.2M5.4 12h13.2" />,
  minus: <path d="M5.4 12h13.2" />,
  target: (
    <>
      <circle cx="12" cy="12" r="7.4" />
      <circle cx="12" cy="12" r="1.6" {...SOLID} />
      <path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6" />
    </>
  ),
  chevronDown: <path d="M6.5 9.75 12 15.25l5.5-5.5" />,
  close: <path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6" />,
  link: (
    <>
      <path d="M14 3.8h6.2V10" />
      <path d="M20.2 3.8 12 12" />
      <path d="M18.4 14v5.2a1.2 1.2 0 0 1-1.2 1.2H4.8a1.2 1.2 0 0 1-1.2-1.2V6.8a1.2 1.2 0 0 1 1.2-1.2H10" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof ICONS

interface Props {
  name: IconName
  size?: number
  className?: string
}

export default function Icon({ name, size = 18, className }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  )
}
