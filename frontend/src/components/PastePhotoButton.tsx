import { useState } from 'react'
import { readClipboardImages } from '../utils/clipboard'
import { Icon } from '../design/ui'

export default function PastePhotoButton({ onFiles, disabled = false }: { onFiles: (files: File[]) => void | Promise<void>; disabled?: boolean }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <div>
      <button type="button" className="btn btn-sm btn-line" disabled={disabled || busy} onClick={async () => {
        setBusy(true); setError('')
        try { await onFiles(await readClipboardImages()) }
        catch (e) { setError(e instanceof Error ? e.message : 'Не удалось вставить фото') }
        finally { setBusy(false) }
      }}><Icon n="plus" s={16} />{busy ? 'Вставляю…' : 'Вставить из буфера'}</button>
      {error && <p className="muted" role="status" style={{ fontSize: 13, marginTop: 6 }}>{error}</p>}
    </div>
  )
}
