import { useState } from 'react'

/** The condition of a problem: the picture from the open FIPI bank when there is one (formulas and drawings exactly
 * as in the source), otherwise the text. Pictures are cut at 150 dpi: shown as 2x, so the letters match the page text. */
export default function ProblemText({ q, img, small, ctx }: { q: string; img?: string | null; small?: boolean; ctx?: string | null }) {
  const [bad, setBad] = useState(false)
  if (ctx) {
    return (
      <>
        <details className="prob-ctx" open={!small}><summary>Общее условие к заданиям 1-5</summary>
          <a className="prob-wrap" href={ctx} target="_blank" rel="noreferrer" title="Открыть крупнее"><img className="prob-img" src={ctx} srcSet={`${ctx} 2x`} alt="Общее условие" loading="lazy" /></a>
        </details>
        <ProblemText q={q} img={img} small={small} />
      </>
    )
  }
  if (img && !bad) return <a className="prob-wrap" href={img} target="_blank" rel="noreferrer" title="Открыть крупнее"><img className={`prob-img ${small ? 'sm' : ''}`} src={img} srcSet={`${img} 2x`} alt={q} loading="lazy" onError={() => setBad(true)} /></a>
  return <>{q}</>
}

/** «Показать ответ» for second-part problems with the answer as a picture. */
export function AnswerPic({ src }: { src?: string | null }) {
  const [open, setOpen] = useState(false)
  if (!src) return null
  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Скрыть ответ' : 'Показать ответ'}</button>
      {open && <img className="prob-img ans" src={src} srcSet={`${src} 2x`} alt="Ответ" loading="lazy" />}
    </div>
  )
}
