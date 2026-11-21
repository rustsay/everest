import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Show source problem images in a reliable in-page viewer instead of relying on a new browser tab. */
export default function ProblemText({ q, img, small, ctx }: { q: string; img?: string | null; small?: boolean; ctx?: string | null }) {
  const [bad, setBad] = useState(false)
  const [zoom, setZoom] = useState<string | null>(null)
  if (ctx) {
    return (
      <>
        <details className="prob-ctx" open={!small}><summary>Общее условие к заданиям 1-5</summary>
          <button type="button" className="prob-wrap prob-open" onClick={() => setZoom(ctx)} title="Открыть крупнее">
            <img className="prob-img" src={ctx} alt="Общее условие" loading="lazy" onError={() => setBad(true)} />
          </button>
        </details>
        <ProblemText q={q} img={img} small={small} />
        {zoom && <ImageViewer src={zoom} onClose={() => setZoom(null)} />}
      </>
    )
  }
  if (img && !bad) return (
    <>
      <button type="button" className="prob-wrap prob-open" onClick={() => setZoom(img)} title="Открыть крупнее">
        <img className={`prob-img ${small ? 'sm' : ''}`} src={img} alt={q} loading="lazy" onError={() => setBad(true)} />
      </button>
      {zoom && <ImageViewer src={zoom} onClose={() => setZoom(null)} />}
    </>
  )
  return <>{q}</>
}

function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const close = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    close.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])

  // The animated page creates a containing block for fixed elements. Keep the viewer outside it.
  return createPortal(
    <div className="prob-lightbox" role="dialog" aria-modal="true" aria-label="Изображение задания" onClick={onClose} onKeyDown={(e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
      if (e.key === 'Tab') { e.preventDefault(); close.current?.focus() }
    }}>
      <button ref={close} type="button" className="prob-lightbox-close" onClick={onClose} aria-label="Закрыть изображение">×</button>
      <img src={src} alt="Условие задания" onClick={(e) => e.stopPropagation()} />
    </div>,
    document.body,
  )
}

/** «Показать ответ» for second-part problems with the answer as a picture. */
export function AnswerPic({ src }: { src?: string | null }) {
  const [open, setOpen] = useState(false)
  if (!src) return null
  return (
    <div style={{ marginTop: 8 }}>
      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Скрыть ответ' : 'Показать ответ'}</button>
      {open && <img className="prob-img ans" src={src} alt="Ответ" loading="lazy" />}
    </div>
  )
}
