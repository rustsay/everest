import { useEffect, useState } from 'react'
import { diagWorkPhoto } from '../api/client'
import type { DiagWork } from '../types'
import PhotoAttachment from './PhotoAttachment'

export default function DiagWorkPhotos({ id, item, work }: { id: number; item: string; work: DiagWork }) {
  const [photos, setPhotos] = useState<{ page: number; src: string }[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    const urls: string[] = []
    setPhotos([]); setError('')
    for (let page = 0; page < work.files; page++) {
      diagWorkPhoto(id, item, page).then((src) => {
        if (!active) { URL.revokeObjectURL(src); return }
        urls.push(src)
        setPhotos((previous) => [...previous, { page, src }].sort((a, b) => a.page - b.page))
      }).catch(() => { if (active) setError('Не удалось открыть фото. Попробуй вернуться к заданию ещё раз.') })
    }
    return () => { active = false; urls.forEach((url) => URL.revokeObjectURL(url)) }
  }, [id, item, work])
  return (
    <>
      {photos.length > 0 && <ul className="photo-files-list" aria-label="Сохранённые фото решения">
        {photos.map(({ page, src }) => <li key={page}><PhotoAttachment src={src} name={`Страница ${page + 1}.jpg`} /></li>)}
      </ul>}
      {error && <p className="muted" role="status">{error}</p>}
    </>
  )
}
