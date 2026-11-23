import type { DiagramPoint, DiagramRelation, GeometryDiagram } from '../types'

const edge = (a: string, b: string, style: GeometryDiagram['edges'][number]['style'] = 'solid'): GeometryDiagram['edges'][number] => ({
  points: [a, b], style,
})
const relation = (kind: DiagramRelation['kind'], points: string[], value?: number, step = 0): DiagramRelation => ({ kind, points, value, step })

const cube: Record<string, DiagramPoint> = {
  A: [0, 0, 0], B: [1, 0, 0], C: [1, 1, 0], D: [0, 1, 0],
  'A₁': [0, 0, 1], 'B₁': [1, 0, 1], 'C₁': [1, 1, 1], 'D₁': [0, 1, 1],
}
const cubeEdges = [
  edge('A', 'B'), edge('B', 'C'), edge('C', 'D', 'hidden'), edge('D', 'A', 'hidden'),
  edge('A', 'A₁'), edge('B', 'B₁'), edge('C', 'C₁'), edge('D', 'D₁', 'hidden'),
  edge('A₁', 'B₁'), edge('B₁', 'C₁'), edge('C₁', 'D₁'), edge('D₁', 'A₁'),
]
const root3 = Math.sqrt(3)

export const TYPICAL_DIAGRAMS: Partial<Record<number, GeometryDiagram>> = {
  1: {
    dimension: 2,
    points: { A: [0, 0, 0], B: [6, 8, 0], C: [16 - 4 * root3, 8, 0], D: [16 + 4 * root3, 0, 0],
      O: [8, 4, 0], E: [4.8, 6.4, 0], F: [8, 8, 0], G: [10, 4 + 2 * root3, 0], H: [8, 0, 0] },
    edges: [edge('A', 'B'), edge('B', 'C'), edge('C', 'D'), edge('D', 'A'),
      ...['E', 'F', 'G', 'H'].map((name) => edge('O', name, 'auxiliary'))],
    circles: [{ center: 'O', through: 'E' }],
    faces: [],
    relations: [relation('length', ['A', 'B'], 10), relation('length', ['C', 'D'], 16),
      relation('equal', ['A', 'E', 'A', 'H'], undefined, 2), relation('equal', ['B', 'E', 'B', 'F'], undefined, 2),
      relation('equal', ['C', 'F', 'C', 'G'], undefined, 2), relation('equal', ['D', 'G', 'D', 'H'], undefined, 2)],
  },
  3: {
    dimension: 3,
    points: { ...cube, M: [0.5, 0, 0], N: [0, 0.5, 0], 'M₁': [0.5, 0, 1], 'N₁': [0, 0.5, 1] },
    edges: [...cubeEdges, edge('M', 'N', 'auxiliary'), edge('M₁', 'N₁', 'auxiliary'),
      edge('M', 'M₁', 'auxiliary'), edge('N', 'N₁', 'auxiliary')],
    circles: [],
    faces: [['A', 'M', 'N'], ['A₁', 'M₁', 'N₁'], ['M', 'N', 'N₁', 'M₁']],
    relations: [relation('midpoint', ['M', 'A', 'B']), relation('midpoint', ['N', 'A', 'D']),
      relation('parallel', ['M', 'M₁', 'A', 'A₁']), relation('perpendicular', ['A', 'M', 'A', 'N'], undefined, 2)],
  },
  14: {
    dimension: 3,
    points: cube,
    edges: [...cubeEdges, edge('B', 'C₁', 'auxiliary'), edge('A', 'D₁', 'auxiliary')],
    circles: [],
    faces: [['A', 'B', 'C₁', 'D₁']],
    relations: [relation('perpendicular', ['A', 'B', 'B', 'C']), relation('perpendicular', ['A', 'B', 'B', 'B₁']),
      relation('perpendicular_plane', ['A', 'B', 'B', 'C', 'C₁'], undefined, 2),
      relation('perpendicular', ['A', 'B', 'B', 'C₁'], undefined, 2),
      relation('angle', ['C₁', 'B', 'C'], 45, 4)],
  },
  17: {
    dimension: 2,
    points: { A: [0, 0, 0], B: [2.5, 2.5 * root3, 0], C: [8, 0, 0] },
    edges: [edge('A', 'B'), edge('B', 'C'), edge('C', 'A')],
    circles: [],
    faces: [],
    relations: [relation('length', ['A', 'B'], 5), relation('length', ['A', 'C'], 8),
      relation('angle', ['B', 'A', 'C'], 60), relation('length', ['B', 'C'], 7, 4)],
  },
}
