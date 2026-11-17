import type { ReactElement } from 'react'

/** Small geometry drawings for task map prototypes (viewBox 120×84). */
const S = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
const D = { ...S, strokeWidth: 1.5, strokeDasharray: '4 3' }
const A = { ...S, stroke: 'var(--gold)', strokeWidth: 2 }
const dot = (x: number, y: number) => <circle cx={x} cy={y} r={2.6} fill="currentColor" />

const FIGS: Record<string, ReactElement> = {
  right: (<>
    <path d="M14 72 L14 14 L108 72 Z" {...S} />
    <path d="M14 62 H24 V72" {...A} />
    <path d="M14 72 L61 43" {...D} />
  </>),
  iso: (<>
    <path d="M14 72 L60 12 L106 72 Z" {...S} />
    <path d="M60 12 V72" {...D} />
    <path d="M34 40 l6 4 M86 40 l-6 4" {...A} />
    <path d="M60 64 h8 v8" {...A} strokeWidth={1.5} />
  </>),
  general: (<>
    <path d="M10 72 L40 12 L110 72 Z" {...S} />
    <path d="M10 72 L66 34" {...D} />
    <path d="M25 42 L75 42" {...A} />
  </>),
  quad: (<>
    <path d="M14 70 L84 70 L106 18 L36 18 Z" {...S} />
    <path d="M14 70 L106 18 M84 70 L36 18" {...D} />
    <path d="M24 70 a10 10 0 0 0 -4 -9" {...A} />
  </>),
  trap: (<>
    <path d="M10 70 L110 70 L82 20 L34 20 Z" {...S} />
    <path d="M34 20 V70" {...D} />
    <path d="M22 45 L96 45" {...A} />
  </>),
  angles: (<>
    <circle cx={60} cy={44} r={32} {...S} />
    <path d="M32.3 60 L60 44 L87.7 60" {...A} />
    <path d="M32.3 60 L54.4 12.5 L87.7 60" {...D} />
    {dot(60, 44)}{dot(54.4, 12.5)}
  </>),
  chords: (<>
    <circle cx={60} cy={44} r={32} {...S} />
    <path d="M29.9 33.1 L87.7 60 M87.7 28 L35.5 64.6" {...A} />
    <path d="M18 76 L102 76" {...S} />
    <path d="M60 44 L60 76" {...D} />
    {dot(60, 76)}
  </>),
  incircle: (<>
    <path d="M12 72 L108 72 L46 12 Z" {...S} />
    <circle cx={51.3} cy={49.1} r={22.9} {...A} />
    <path d="M51.3 49.1 L51.3 72" {...D} />
    {dot(51.3, 49.1)}
  </>),
  circum: (<>
    <circle cx={60} cy={44} r={32} {...A} />
    <path d="M29.9 54.9 L90.1 54.9 L54.4 12.5 Z" {...S} />
    <path d="M60 44 L90.1 54.9" {...D} />
    {dot(60, 44)}
  </>),
  trig: (<>
    <path d="M14 72 L106 72 L106 18 Z" {...S} />
    <path d="M96 72 V62 H106" {...A} />
    <path d="M34 72 a20 20 0 0 0 -3 -11" {...A} />
    <text x={38} y={66} fontSize={12} fontWeight={800} fill="currentColor">α</text>
  </>),
  area: (<>
    <path d="M16 70 L92 70 L106 22 L30 22 Z" {...S} fill="var(--em-soft)" />
    <path d="M30 22 V70" {...D} />
    <text x={52} y={52} fontSize={15} fontWeight={800} fill="currentColor">S</text>
  </>),
}

export default function GeoFig({ k, w = 72 }: { k: string; w?: number }) {
  return (
    <svg viewBox="0 0 120 84" width={w} height={(w * 84) / 120} aria-hidden="true" style={{ flex: 'none', color: 'var(--ink)' }}>
      {FIGS[k] ?? null}
    </svg>
  )
}
