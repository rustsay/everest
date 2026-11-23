import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../design/ui'

/** A local file or an authenticated saved photo, with an in-page preview. */
export default function PhotoAttachment({ file, src, name = file?.name ?? 'Фото решения', type = file?.type ?? 'image/jpeg', onRemove, disabled = false }: {
  file?: File; src?: string; name?: string; type?: string; onRemove?: () => void; disabled?: boolean
}) {
  const [localUrl, setLocalUrl] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!file) return
    const url = URL.createObjectURL(file)
    setLocalUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  const url = src ?? localUrl
  const image = type.startsWith('image/') && !/hei[cf]/i.test(type + name)
  return (
    <>
      <button type="button" className="photo-files-open" onClick={() => setOpen(true)} disabled={!url} aria-label={`Посмотреть ${name}`} title={name}>
        {image && url ? <img className="photo-files-thumb" src={url} alt="" /> : <Icon n="slides" s={20} />}
        <span>{name}</span><Icon n="full" s={14} />
      </button>
      {onRemove && <button type="button" className="photo-files-remove" disabled={disabled} onClick={onRemove} aria-label={`Убрать файл ${name}`}><Icon n="close" s={16} /></button>}
      {open && url && <Preview src={url} name={name} type={type} onClose={() => setOpen(false)} />}
    </>
  )
}

function Preview({ src, name, type, onClose }: { src: string; name: string; type: string; onClose: () => void }) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const [bad, setBad] = useState(false)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    close.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  const pdf = type === 'application/pdf' || /\.pdf$/i.test(name)
  return createPortal(
    <div className="scrim attachment-scrim" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div ref={panel} className="modal attachment-preview" role="dialog" aria-modal="true" aria-label={`Просмотр: ${name}`} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose() }
        if (event.key === 'Tab') {
          const items = panel.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),iframe')
          if (!items?.length) return
          const first = items[0], last = items[items.length - 1]
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
        }
      }}>
        <div className="modal-h"><h2>{name}</h2><button ref={close} type="button" className="iconbtn" onClick={onClose} aria-label="Закрыть просмотр"><Icon n="close" /></button></div>
        {pdf ? <iframe src={src} title={name} /> : bad ? <p className="muted">Браузер не может показать этот формат. Скачай файл, чтобы открыть его на устройстве.</p>
          : <img src={src} alt={name} onError={() => setBad(true)} />}
        <a className="btn btn-sm btn-line" href={src} download={name}>Скачать файл</a>
      </div>
    </div>, document.body,
  )
}
