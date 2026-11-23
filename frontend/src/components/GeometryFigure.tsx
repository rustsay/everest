import { useId } from 'react'
import type { DiagramPoint, DiagramRelation, GeometryDiagram } from '../types'

type Point = [number, number]
const format = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 4 })
const segment = (names: string[]) => names.every((name) => name.length === 1) ? names.join('') : names.join('–')
const edgeKey = (names: string[]) => [...names].sort().join('|')

function relationText({ kind, points: p, value }: DiagramRelation) {
  const ab = segment(p.slice(0, 2))
  const cd = segment(p.slice(2))
  switch (kind) {
    case 'length': return value != null ? `${ab} = ${format(value)}` : null
    case 'angle': return value != null ? `∠${segment(p)} = ${format(value)}°` : null
    case 'equal': return `${ab} = ${cd}`
    case 'parallel': return `${ab} ∥ ${cd}`
    case 'perpendicular': return `${ab} ⟂ ${cd}`
    case 'midpoint': return `${p[0]} — середина ${segment(p.slice(1))}`
    case 'tangent': return `${cd} касается окружности с центром ${p[0]}`
    case 'perpendicular_plane': return `${ab} ⟂ (${cd})`
    default: return null
  }
}

function relationEdges({ kind, points: p }: DiagramRelation) {
  switch (kind) {
    case 'angle': return [edgeKey(p.slice(0, 2)), edgeKey(p.slice(1))]
    case 'midpoint': case 'on_segment': return [edgeKey(p.slice(1))]
    case 'tangent': return [edgeKey(p.slice(2))]
    case 'equal': case 'parallel': case 'perpendicular': return [edgeKey(p.slice(0, 2)), edgeKey(p.slice(2))]
    case 'length': case 'perpendicular_plane': return [edgeKey(p.slice(0, 2))]
    default: return []
  }
}

function project([x, y, z]: DiagramPoint, spatial: boolean): Point {
  return spatial ? [x + 0.48 * y, -z - 0.36 * y + 0.11 * x] : [x, -y]
}

function along(a: Point, b: Point, distance: number): Point {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [a[0] + (b[0] - a[0]) * distance / length, a[1] + (b[1] - a[1]) * distance / length]
}

export default function GeometryFigure({ diagram, step }: { diagram: GeometryDiagram; step: number }) {
  const id = useId()
  const entries = Object.entries(diagram.points)
  const spatial = diagram.dimension === 3
  const projected = entries.map(([name, point]) => [name, project(point, spatial)] as const)
  const xs = projected.map(([, p]) => p[0])
  const ys = projected.map(([, p]) => p[1])
  const circles = diagram.circles.map(({ center, through }) => {
    const [x, y] = project(diagram.points[center], spatial)
    const [tx, ty] = project(diagram.points[through], spatial)
    const radius = Math.hypot(tx - x, ty - y)
    xs.push(x - radius, x + radius)
    ys.push(y - radius, y + radius)
    return { center, radius }
  })
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  const width = 460, height = 280
  const scale = Math.min((width - 100) / Math.max(maxX - minX, 1e-8), (height - 72) / Math.max(maxY - minY, 1e-8))
  const points = Object.fromEntries(projected.map(([name, [x, y]]) =>
    [name, [width / 2 + (x - (minX + maxX) / 2) * scale, height / 2 + (y - (minY + maxY) / 2) * scale] as Point]))
  const visible = diagram.relations.filter((r) => r.step === 0 || r.step <= step)
  const active = visible.filter((r) => r.step === step)
  const highlighted = new Set(active.flatMap(relationEdges))
  const existingEdges = new Set(diagram.edges.map(({ points }) => edgeKey(points)))
  const highlightedParts = [...highlighted].filter((key) => !existingEdges.has(key))
  const grid = (diagram.grid ?? 0) * scale
  const positions = Object.values(points)
  const labels: { x: number; y: number; width: number }[] = []
  // Prefer labels outside the shape and move them away from nearby points and previous labels.
  const placeLabel = ([x, y]: Point, width: number) => {
    const dx = x < 230 ? -1 : 1
    const dy = y < 140 ? -1 : 1
    const offsets = [[dx * (8 + width / 2), dy * 11], [-dx * (8 + width / 2), dy * 11],
      [dx * (8 + width / 2), -dy * 11], [-dx * (8 + width / 2), -dy * 11], [0, dy * 18], [0, -dy * 18]]
    const candidates = offsets.map(([ox, oy]) => ({ x: x + ox, y: y + oy, width }))
    const spot = candidates.find((c) => (
      c.x - width / 2 > 0 && c.x + width / 2 < 460 && c.y > 10 && c.y < 270 &&
      positions.every(([px, py]) => Math.abs(px - c.x) > width / 2 + 3 || Math.abs(py - c.y) > 8) &&
      labels.every((label) => Math.abs(label.x - c.x) > (label.width + width) / 2 + 4 || Math.abs(label.y - c.y) > 14)
    )) ?? candidates[0]
    labels.push(spot)
    return spot
  }

  return <figure className="walk-figure">
    <figcaption><strong>Чертёж к задаче</strong>{spatial && <span>Пространственная проекция</span>}</figcaption>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Геометрический чертёж с обозначениями">
      {grid >= 6 && <>
        <defs><pattern id={id} x={width / 2 - (minX + maxX) / 2 * scale} y={height / 2 - (minY + maxY) / 2 * scale}
          width={grid} height={grid} patternUnits="userSpaceOnUse">
          <path d={`M ${grid} 0 H 0 V ${grid}`} fill="none" stroke="currentColor" opacity=".2" />
        </pattern></defs>
        <rect width={width} height={height} fill={`url(#${id})`} />
      </>}
      {diagram.faces.map((face, i) => <polygon key={i} className="walk-face" points={face.map((name) => points[name].join(',')).join(' ')} />)}
      {circles.map(({ center, radius }, i) => <circle key={i} className="walk-edge" cx={points[center][0]} cy={points[center][1]} r={radius * scale} />)}
      {diagram.edges.map(({ points: names, style }, i) => {
        const [a, b] = names.map((name) => points[name])
        return <line key={i} className={`walk-edge ${style} ${highlighted.has(edgeKey(names)) ? 'active' : ''}`}
          x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
      })}
      {highlightedParts.map((key) => {
        const [a, b] = key.split('|').map((name) => points[name])
        return <line key={key} className="walk-edge auxiliary active" x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} />
      })}
      {visible.map((r, i) => {
        if (r.kind === 'length' && r.value != null) {
          const [a, b] = r.points.map((name) => points[name])
          const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2
          const caption = format(r.value)
          const label = placeLabel([x, y], caption.length * 8)
          return <text key={i} {...{ x: label.x, y: label.y }} className="walk-measure">{caption}</text>
        }
        if (r.kind !== 'angle' || r.value == null || spatial) return null
        const [a, vertex, b] = r.points.map((name) => points[name])
        const radius = Math.min(24, Math.hypot(a[0] - vertex[0], a[1] - vertex[1]) / 3, Math.hypot(b[0] - vertex[0], b[1] - vertex[1]) / 3)
        const start = along(vertex, a, radius), end = along(vertex, b, radius)
        const sweep = (a[0] - vertex[0]) * (b[1] - vertex[1]) - (a[1] - vertex[1]) * (b[0] - vertex[0]) > 0 ? 1 : 0
        const path = r.value === 90
          ? `M${start} L${start[0] + end[0] - vertex[0]},${start[1] + end[1] - vertex[1]} L${end}`
          : `M${start} A${radius} ${radius} 0 0 ${sweep} ${end}`
        const bisector: Point = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
        const caption = `${format(r.value)}°`
        const label = placeLabel(along(vertex, bisector, radius + 7), caption.length * 8)
        return <g key={i}><path className="walk-mark" d={path} />
          {r.value !== 90 && <text x={label.x} y={label.y} className="walk-measure">{caption}</text>}</g>
      })}
      {entries.map(([name]) => {
        const [x, y] = points[name]
        const label = placeLabel([x, y], name.length * 9)
        return <g key={name}><circle cx={x} cy={y} r={2.5} fill="currentColor" /><text x={label.x} y={label.y}>{name}</text></g>
      })}
    </svg>
    <ul className="walk-figure-key" aria-label="Обозначения на чертеже">
      {visible.map((r, i) => {
        const label = relationText(r)
        return label && <li key={i} className={r.step === step ? 'active' : undefined}>{label}</li>
      })}
    </ul>
  </figure>
}
