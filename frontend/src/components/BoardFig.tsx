import type { ReactElement } from 'react'
import GeoFig from './GeoFig'

/** Chalk drawings for the board: the figure of the problem with its letters and given data (viewBox 200×150). */
const C = '#F3EEDF', Y = '#F2C46B', G = '#9FD3B8'
const L = { fill: 'none', stroke: C, strokeWidth: 2.2, strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const }
const H = { ...L, stroke: Y, strokeWidth: 2.6 }
const D = { ...L, strokeWidth: 1.6, strokeDasharray: '5 4' }
const T = (x: number, y: number, s: string, c = C, size = 13) => <text x={x} y={y} fill={c} fontSize={size} fontWeight={700} fontFamily="inherit">{s}</text>

const FIGS: Record<number, ReactElement> = {
  // 1: a circle inscribed in the quadrilateral ABCD, AB = 10, CD = 16
  1: (<>
    <path d="M28 126 L58 30 L142 30 L176 126 Z" {...L} />
    <circle cx={101} cy={78} r={47} {...D} />
    {T(14, 140, 'A')}{T(48, 24, 'B')}{T(144, 24, 'C')}{T(178, 140, 'D')}
    {T(18, 78, '10', Y)}{T(166, 78, '16', Y)}
  </>),
  // 2: 14a + 2b = (12; 16), its length is the hypotenuse of 12 and 16
  2: (<>
    <path d="M20 132 H190 M24 140 V10" {...L} strokeWidth={1.6} />
    <path d="M24 132 L114 12" {...H} /><path d="M114 12 l-11 3 m11 -3 l-2 11" {...H} />
    <path d="M24 132 H114 V12" {...D} />
    {T(60, 147, '12', G)}{T(120, 78, '16', G)}{T(44, 64, '14a + 2b', Y)}{T(12, 147, '0')}
  </>),
  // 3: the cube and the prism cut off through the midpoints of two neighbouring base edges
  3: (<>
    <path d="M30 60 H120 V140 H30 Z M30 60 L70 30 H160 L120 60 M160 30 V110 L120 140" {...L} />
    <path d="M30 140 L70 110 H160 M70 110 V30" {...D} />
    <path d="M75 140 L52 125 M75 60 L52 45 M52 45 V125 M75 60 V140" {...H} />
    {T(88, 148, 'середины рёбер', G, 11)}
  </>),
  // 14: the cube ABCDA1B1C1D1, the plane ABC1
  14: (<>
    <path d="M30 60 H120 V140 H30 Z M30 60 L70 30 H160 L120 60 M160 30 V110 L120 140" {...L} />
    <path d="M30 140 L70 110 H160 M70 110 V30" {...D} />
    <path d="M30 140 H120 L160 30 L70 30 Z" fill={Y} fillOpacity={0.14} stroke="none" />
    <path d="M30 140 H120 M120 140 L160 30" {...H} />
    {T(16, 148, 'A')}{T(124, 148, 'B')}{T(164, 116, 'C')}{T(162, 26, 'C₁')}{T(14, 58, 'A₁')}{T(124, 56, 'B₁')}
  </>),
  // 17: AB = 5, AC = 8, angle A = 60°
  17: (<>
    <path d="M24 128 L176 128 L84 24 Z" {...L} />
    <path d="M44 128 A20 20 0 0 0 36 112" {...H} />
    {T(10, 140, 'A')}{T(178, 140, 'C')}{T(80, 18, 'B')}
    {T(36, 76, '5', Y)}{T(96, 146, '8', Y)}{T(50, 120, '60°', G, 12)}
  </>),
}

export function hasBoardFig(n?: number) {
  return n != null && n in FIGS
}

/** The drawing of the typical walkthrough of task n, or the figure of a task map prototype. */
export default function BoardFig({ n, proto }: { n?: number; proto?: string | null }) {
  if (n != null && FIGS[n]) {
    return <svg viewBox="0 0 200 150" className="board-fig" role="img" aria-label="Рисунок к задаче">{FIGS[n]}</svg>
  }
  if (proto) return <div className="board-fig geo" style={{ color: C }}><GeoFig k={proto} w={170} color={C} /></div>
  return null
}
