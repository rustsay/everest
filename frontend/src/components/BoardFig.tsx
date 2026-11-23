import type { ReactElement } from 'react'
import GeoFig from './GeoFig'

/** Chalk drawings for the board: the figure of the problem with its letters and given data (viewBox 200×150). */
const C = '#F3EEDF', Y = '#F2C46B', G = '#9FD3B8'
const L = { fill: 'none', stroke: C, strokeWidth: 2.2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
const H = { ...L, stroke: Y, strokeWidth: 2.6 }
const D = { ...L, strokeWidth: 1.6, strokeDasharray: '5 4' }
const T = (x: number, y: number, s: string, c = C, size = 13) => <text x={x} y={y} fill={c} fontSize={size} fontWeight={700} fontFamily="inherit">{s}</text>
const derivative = Array.from({ length: 101 }, (_, i) => {
  const x = (i - 50) / 20
  return `${100 + 34 * x},${75 - 9 * (x ** 3 - 4 * x)}`
}).join(' ')

const FIGS: Record<number, ReactElement> = {
  2: (<>
    <path d="M20 132 H190 M24 140 V10" {...L} strokeWidth={1.6} />
    <path d="M24 132 L114 12" {...H} /><path d="M114 12 l-11 3 m11 -3 l-2 11" {...H} />
    <path d="M24 132 H114 V12" {...D} />
    {T(60, 147, '12', G)}{T(120, 78, '16', G)}{T(44, 64, '14a + 2b', Y)}{T(12, 147, '0')}
  </>),
  8: (<>
    <path d="M8 75 H191 l-6 -4 m6 4 l-6 4 M100 146 V5 l-4 6 m4 -6 l4 6" {...L} />
    <polyline points={derivative} {...H} />
    {[32, 100, 168].map((x) => <circle key={x} cx={x} cy={75} r={3} fill={C} />)}
    {T(23, 92, '−2')}{T(87, 92, '0')}{T(166, 67, '2')}{T(187, 90, 'x')}{T(112, 15, 'f′(x)', Y)}
  </>),
}

/** The drawing of the typical walkthrough of task n, or the figure of a task map prototype. */
export default function BoardFig({ n, proto }: { n?: number; proto?: string | null }) {
  if (n != null && FIGS[n]) {
    return <svg viewBox="0 0 200 150" className="board-fig" role="img" aria-label="Рисунок к задаче">{FIGS[n]}</svg>
  }
  if (proto) return <div className="board-fig geo" style={{ color: C }}><GeoFig k={proto} w={170} color={C} /></div>
  return null
}
