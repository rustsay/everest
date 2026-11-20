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
  // figures for slides: functions and solids
  unit: (<>
    <path d="M8 42 H112 M60 4 V80" {...S} strokeWidth={1.2} />
    <circle cx={60} cy={42} r={34} {...S} />
    <path d="M60 42 L84 18" {...A} /><path d="M84 18 V42" {...D} />
    {dot(84, 18)}
    <path d="M72 42 a12 12 0 0 0 -3.5 -8.5" {...A} />
    <text x={88} y={16} fontSize={11} fontWeight={800} fill="currentColor">M</text><text x={74} y={38} fontSize={10} fontWeight={800} fill="currentColor">α</text>
  </>),
  parab: (<>
    <path d="M8 70 H112 M60 4 V80" {...S} strokeWidth={1.2} />
    <path d="M26 8 Q60 132 94 8" {...A} />
    <text x={96} y={18} fontSize={11} fontWeight={800} fill="currentColor">y = x²</text>
  </>),
  expg: (<>
    <path d="M8 70 H112 M50 4 V80" {...S} strokeWidth={1.2} />
    <path d="M8 68 C40 66 52 60 62 48 S80 12 86 4" {...A} />
    {dot(50, 58)}<text x={54} y={64} fontSize={10} fontWeight={800} fill="currentColor">1</text>
    <text x={88} y={16} fontSize={11} fontWeight={800} fill="currentColor">y = aˣ</text>
  </>),
  logg: (<>
    <path d="M8 50 H112 M20 4 V80" {...S} strokeWidth={1.2} />
    <path d="M22 80 C24 60 28 52 36 50 S70 38 112 30" {...A} />
    {dot(36, 50)}<text x={32} y={62} fontSize={10} fontWeight={800} fill="currentColor">1</text>
    <text x={70} y={26} fontSize={11} fontWeight={800} fill="currentColor">y = logₐx</text>
  </>),
  sing: (<>
    <path d="M4 42 H116 M14 6 V78" {...S} strokeWidth={1.2} />
    <path d="M14 42 C24 12 34 12 44 42 S64 72 74 42 S94 12 104 42" {...A} />
    <text x={40} y={56} fontSize={10} fontWeight={800} fill="currentColor">π</text><text x={70} y={34} fontSize={10} fontWeight={800} fill="currentColor">2π</text>
  </>),
  tangent: (<>
    <path d="M8 74 H112 M16 4 V80" {...S} strokeWidth={1.2} />
    <path d="M18 70 C40 66 60 50 70 34 S90 8 100 4" {...S} />
    <path d="M30 76 L104 8" {...A} />{dot(66, 40)}
    <path d="M66 40 V74" {...D} /><text x={62} y={84} fontSize={10} fontWeight={800} fill="currentColor">x₀</text>
  </>),
  line: (<>
    <path d="M6 46 H114" {...S} /><path d="M108 41 l6 5 -6 5" {...S} />
    <path d="M30 46 Q48 20 66 46" {...A} />
    <circle cx={30} cy={46} r={3.5} fill="var(--surface, #fff)" stroke="currentColor" strokeWidth={2} />
    <circle cx={66} cy={46} r={3.5} fill="currentColor" />
    <text x={26} y={64} fontSize={11} fontWeight={800} fill="currentColor">a</text><text x={62} y={64} fontSize={11} fontWeight={800} fill="currentColor">b</text>
  </>),
  cube: (<>
    <path d="M18 30 H74 V78 H18 Z M18 30 L44 8 H100 L74 30 M100 8 V56 L74 78" {...S} />
    <path d="M18 78 L44 56 H100 M44 56 V8" {...D} />
  </>),
  pyramid: (<>
    <path d="M14 70 L76 70 L104 52 M14 70 L60 8 L76 70 M60 8 L104 52" {...S} />
    <path d="M14 70 L42 52 H104 M42 52 L60 8" {...D} />
    <path d="M60 8 V61" {...A} />
  </>),
  cyl: (<>
    <ellipse cx={60} cy={16} rx={32} ry={9} {...S} />
    <path d="M28 16 V68 M92 16 V68" {...S} />
    <path d="M28 68 A32 9 0 0 0 92 68" {...S} /><path d="M28 68 A32 9 0 0 1 92 68" {...D} />
    <path d="M60 16 H92" {...A} />
  </>),
  cone: (<>
    <path d="M28 66 L60 8 L92 66" {...S} />
    <path d="M28 66 A32 9 0 0 0 92 66" {...S} /><path d="M28 66 A32 9 0 0 1 92 66" {...D} />
    <path d="M60 8 V66 H92" {...A} />
  </>),
  sphere: (<>
    <circle cx={60} cy={42} r={36} {...S} />
    <path d="M24 42 A36 10 0 0 0 96 42" {...S} /><path d="M24 42 A36 10 0 0 1 96 42" {...D} />
    <path d="M60 42 L94 30" {...A} />{dot(60, 42)}
  </>),
}

export default function GeoFig({ k, w = 72, color = 'var(--ink)' }: { k: string; w?: number; color?: string }) {
  return (
    <svg viewBox="0 0 120 84" width={w} height={(w * 84) / 120} aria-hidden="true" style={{ flex: 'none', color }}>
      {FIGS[k] ?? null}
    </svg>
  )
}
