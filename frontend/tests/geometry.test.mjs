import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'

function loadComponent(path) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  const exports = {}
  new Function('require', 'exports', compiled)(createRequire(import.meta.url), exports)
  return exports
}

const { TYPICAL_DIAGRAMS } = loadComponent('../src/pages/videoGeometry.ts')
const { VTASK } = loadComponent('../src/pages/videoData.ts')
const { default: GeometryFigure } = loadComponent('../src/components/GeometryFigure.tsx')
const { default: BoardMath } = loadComponent('../src/components/BoardMath.tsx')
const distance = ([x, y], [a, b]) => Math.hypot(x - a, y - b)
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`)

test('the inscribed circle touches all four actual sides and the lengths match the condition', () => {
  const { A, B, C, D, O, E, F, G, H } = TYPICAL_DIAGRAMS[1].points
  close(distance(A, B), 10)
  close(distance(C, D), 16)
  for (const [a, b, t] of [[A, B, E], [B, C, F], [C, D, G], [D, A, H]]) {
    close(distance(O, t), 4)
    close(distance(a, t) + distance(t, b), distance(a, b))
    close((b[0] - a[0]) * (t[0] - O[0]) + (b[1] - a[1]) * (t[1] - O[1]), 0)
  }
})

test('the room for the unknown side label is revealed at the right step', () => {
  const diagram = TYPICAL_DIAGRAMS[17]
  const render = (step) => renderToStaticMarkup(createElement(GeometryFigure, { diagram, step }))
  assert.match(render(1), /Чертёж к задаче/)
  assert.match(render(1), /60°/)
  assert.doesNotMatch(render(1), /BC = 7/)
  assert.match(render(4), /BC = 7/)
  assert.match(render(4), /walk-edge solid active/)
})

test('all typical steps have a full explanation separate from the narration', () => {
  assert.equal(Object.keys(VTASK).length, 19)
  for (const task of Object.values(VTASK)) {
    assert.ok(task.s.every(([, , narration, details]) => details?.length > narration.length), task.t)
  }
})

test('board math renders radicals, fractions, powers and subscripts without code notation', () => {
  const math = 'Math.sqrt(9 + sqrt(16)) + pow(x + 1, 2) + x^(3/2) + A_1'
  const html = renderToStaticMarkup(createElement(BoardMath, { text: math }))
  assert.equal((html.match(/class="board-math-root"/g) || []).length, 2)
  assert.match(html, /\(x \+ 1\)<sup class="board-math-script">2<\/sup>/)
  assert.match(html, /class="board-math-fraction"/)
  assert.match(html, /<sub class="board-math-script">1<\/sub>/)
  assert.doesNotMatch(html, /sqrt|pow|\^|A_1/)
})

test('board math renders legacy TeX and preserves scope of the radicand', () => {
  const math = '\\(\\frac{\\sqrt[3]{8 + 19}}{4}\\leq 1\\)'
  const html = renderToStaticMarkup(createElement(BoardMath, { text: math }))
  assert.match(html, /class="board-math-root-index">3<\/sup>/)
  assert.match(html, /class="board-math-radicand">8 \+ 19<\/span>/)
  assert.match(html, /≤ 1/)
  assert.match(html, /class="board-math-slash"/)
  assert.doesNotMatch(html, /\\|sqrt|frac\{/)
})

test('board math keeps the vector notation added in main alongside roots', () => {
  const html = renderToStaticMarkup(createElement(BoardMath, { text: '|a\u20d7| = sqrt(12² + 16²)' }))
  assert.match(html, /class="math-vector" role="img" aria-label="вектор a"/)
  assert.match(html, /class="board-math-root"/)
  assert.doesNotMatch(html, /sqrt/)
})
