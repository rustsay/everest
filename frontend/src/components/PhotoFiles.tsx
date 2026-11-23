import { useRef } from 'react'
import { Icon } from '../design/ui'
import PastePhotoButton from './PastePhotoButton'
import PhotoAttachment from './PhotoAttachment'

/** Shared photo picker for a bank problem and the photo-check page. */
export default function PhotoFiles({ id, files, onChange, disabled = false, accept = '.jpg,.jpeg,.png,.webp,.heic,.heif,.pdf', formats = 'JPG, JPEG, PNG, WebP, HEIC, HEIF, PDF', actionLabel }: {
  id: string; files: File[]; onChange: (files: File[]) => void; disabled?: boolean; accept?: string; formats?: string; actionLabel?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const full = files.length >= 5
  return (
    <div className="field photo-files">
      <div className="photo-files-heading">
        <label htmlFor={id}>Фото решения (до 5)</label>
        {files.length > 0 && <span className="muted num">{files.length} из 5</span>}
      </div>
      <button type="button" className="photo-files-pick" disabled={disabled || full} onClick={() => input.current?.click()}>
        <span className="photo-files-icon"><Icon n="check" s={22} /></span>
        <span className="photo-files-copy">
          <b>{full ? 'Все файлы прикреплены' : actionLabel ?? (files.length ? 'Добавить файлы' : 'Прикрепить фото или PDF')}</b>
          <small>{formats} · до 15 МБ на файл</small>
        </span>
        {!full && <Icon n="plus" s={18} />}
      </button>
      <input ref={input} id={id} type="file" hidden multiple accept={accept} disabled={disabled || full}
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? [])
          if (selected.length) onChange([...files, ...selected].slice(0, 5))
          event.target.value = ''
        }} />
      <div className="photo-files-actions">
        <PastePhotoButton disabled={disabled || full} onFiles={(images) => onChange([...files, ...images].slice(0, 5))} />
        <span className="muted">или Ctrl+V / ⌘V</span>
      </div>
      {files.length > 0 && <ul className="photo-files-list" aria-label="Прикреплённые файлы">
        {files.map((file, index) => <li key={`${file.name}-${index}`}>
          <PhotoAttachment file={file} disabled={disabled} onRemove={() => onChange(files.filter((_, i) => i !== index))} />
        </li>)}
      </ul>}
    </div>
  )
}
