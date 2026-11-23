import { memo } from 'react'
import type { ReactNode } from 'react'

const SYMBOLS: Record<string, string> = {
  cdot: '·', times: '×', div: '÷', le: '≤', leq: '≤', ge: '≥', geq: '≥',
  ne: '≠', neq: '≠', approx: '≈', pm: '±', mp: '∓', pi: 'π', alpha: 'α',
  beta: 'β', theta: 'θ', infty: '∞', in: '∈', notin: '∉', angle: '∠',
  perp: '⊥', parallel: '∥', Rightarrow: '⇒', to: '→', cup: '∪', cap: '∩',
  ldots: '…', sin: 'sin', cos: 'cos', tan: 'tg', tg: 'tg', ln: 'ln', log: 'log',
}
const CLOSE: Record<string, string> = { '(': ')', '[': ']', '{': '}' }

export function MathVector({ letter }: { letter: string }) {
  return <span className="math-vector" role="img" aria-label={'вектор ' + letter}>
    <svg viewBox="0 0 16 6" preserveAspectRatio="none" aria-hidden="true"><path d="M1 3h13M11 1l3 2-3 2" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
    <span aria-hidden="true">{letter}</span>
  </span>
}

// Parse only presentation notation. The board never evaluates a formula or inserts HTML.
function group(source: string, start: number) {
  if (!(source[start] in CLOSE)) return null
  const stack = [CLOSE[source[start]]]
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i]
    if (char in CLOSE) stack.push(CLOSE[char])
    else if (char === stack[stack.length - 1]) {
      stack.pop()
      if (!stack.length) return { value: source.slice(start + 1, i), end: i + 1 }
    }
  }
  return null
}

function powerArgs(source: string) {
  for (let i = 0; i < source.length; i++) {
    const inner = group(source, i)
    if (inner) { i = inner.end - 1; continue }
    if (source[i] === ',') {
      const base = source.slice(0, i).trim(), exponent = source.slice(i + 1).trim()
      return base && exponent ? { base, exponent } : null
    }
  }
  return null
}

function atom(source: string, start: number, signed = false) {
  const value = group(source, start)
  if (value) return value
  const rest = source.slice(start)
  const match = rest.match(signed
    ? /^[+−-]?(?:\d+(?:[.,]\d+)?|[A-Za-zΑ-ωА-Яа-я])/
    : /^(?:\d+(?:[.,]\d+)?|[A-Za-zΑ-ωА-Яа-я])[₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]*/)
  return match ? { value: match[0], end: start + match[0].length } : null
}

function typeset(source: string, depth = 0): ReactNode {
  if (depth >= 20) return source
  const out: ReactNode[] = []
  const render = (part: string) => typeset(part, depth + 1)
  let plain = ''
  const add = (node: ReactNode) => {
    if (plain) { out.push(plain); plain = '' }
    out.push(node)
  }
  for (let i = 0; i < source.length;) {
    const rest = source.slice(i)
    const previous = source[i - 1] || ''
    const vector = rest.match(/^(\p{L})\u20d7/u)
    if (vector) {
      add(<MathVector key={i} letter={vector[1]} />)
      i += vector[0].length
      continue
    }
    const boundary = !/[\p{L}\p{N}_]/u.test(previous)
    const root = rest.match(/^(\\sqrt|√|∛|∜)/)
      || (boundary ? rest.match(/^(?:Math\.)?sqrt(?=\s*[(\[{]|\s+[0-9A-Za-zΑ-ω])/i) : null)
    if (root) {
      let start = i + root[0].length
      while (/\s/.test(source[start] || '')) start++
      const optionalIndex = root[0] === '\\sqrt' && source[start] === '[' ? group(source, start) : null
      if (optionalIndex) {
        start = optionalIndex.end
        while (/\s/.test(source[start] || '')) start++
      }
      const value = atom(source, start)
      const index = optionalIndex?.value || (root[0] === '∛' ? '3' : root[0] === '∜' ? '4' : '')
      if (value) {
        add(<span className="board-math-root" key={i}>
          {index && <sup className="board-math-root-index">{render(index)}</sup>}
          <span className="board-math-symbol">√</span>
          <svg className="board-math-root-sign" viewBox="0 0 12 20" preserveAspectRatio="none" aria-hidden="true">
            <path d="M .7 11 h 2.5 L 6.2 18.8 11 .6 H 12" fill="none" stroke="currentColor"
              strokeWidth="1.15" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="board-math-radicand">{render(value.value)}</span>
        </span>)
        i = value.end
      } else {
        plain += index === '3' ? '∛' : index === '4' ? '∜' : '√'
        i = start
      }
      continue
    }

    const pow = boundary ? rest.match(/^(?:Math\.)?pow\s*(?=\()/i) : null
    const call = pow ? group(source, i + pow[0].length) : null
    const args = call ? powerArgs(call.value) : null
    if (call && args) {
      const simpleBase = /^(?:\d+(?:[.,]\d+)?|\p{L})$/u.test(args.base)
      add(<span key={i}>{simpleBase ? render(args.base) : <>({render(args.base)})</>}
        <sup className="board-math-script">{render(args.exponent)}</sup></span>)
      i = call.end
      continue
    }

    const frac = rest.match(/^\\[dt]?frac\s*(?=\{)/)
    const numberRatio = !/[\p{L}\p{N}.,/]/u.test(previous)
      ? rest.match(/^([−-]?\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)(?![\p{L}\d.,/])/u) : null
    if (frac || numberRatio) {
      const numerator = frac ? group(source, i + frac[0].length) : null
      const denominator = numerator ? group(source, numerator.end + (source.slice(numerator.end).match(/^\s*/)?.[0].length ?? 0)) : null
      if (numberRatio || (numerator && denominator)) {
        add(<span className="board-math-fraction" key={i}>
          <span>{render(numberRatio?.[1] ?? numerator!.value)}</span>
          <span className="board-math-slash">/</span>
          <span>{render(numberRatio?.[2] ?? denominator!.value)}</span>
        </span>)
        i = numberRatio ? i + numberRatio[0].length : denominator!.end
        continue
      }
    }

    if (source[i] === '^' || source[i] === '_' || rest.startsWith('**')) {
      const sub = source[i] === '_'
      const start = i + (rest.startsWith('**') ? 2 : 1)
      const value = atom(source, start, !sub)
      if (value) {
        add(sub ? <sub className="board-math-script" key={i}>{render(value.value)}</sub>
          : <sup className="board-math-script" key={i}>{render(value.value)}</sup>)
        i = value.end
        continue
      }
    }
    plain += source[i++]
  }
  if (plain) out.push(plain)
  return out
}

export default memo(function BoardMath({ text }: { text: string }) {
  const source = text
    .replace(/\\(?:left|right|displaystyle)\b\s*/g, '')
    .replace(/\\(?:text|mathrm|operatorname)\{([^{}]+)\}/g, '$1')
    .replace(/\\([A-Za-z]+)\b/g, (command, name: string) => SYMBOLS[name] ?? command)
    .replace(/\\([()[\]])|\$+|\x60+/g, '')
    .replace(/\\[,;!]/g, ' ')
    .replace(/<=|>=|!=|->|=>/g, (token) => ({ '<=': '≤', '>=': '≥', '!=': '≠', '->': '→', '=>': '⇒' }[token] ?? token))
    .replace(/(?<=[0-9A-Za-z\])])\s*(?<!\*)\*(?!\*)\s*(?=[0-9A-Za-z[(])/g, ' · ')
  return <>{typeset(source)}</>
})
