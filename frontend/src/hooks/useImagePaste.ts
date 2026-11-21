import { useEffect, useRef } from 'react'
import { clipboardImages } from '../utils/clipboard'

export default function useImagePaste(onFiles: (files: File[]) => void, disabled = false) {
  const current = useRef({ onFiles, disabled })
  current.current = { onFiles, disabled }
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || current.current.disabled) return
      const files = clipboardImages(event.clipboardData)
      if (!files.length) return
      event.preventDefault()
      current.current.onFiles(files)
    }
    document.addEventListener('paste', paste)
    return () => document.removeEventListener('paste', paste)
  }, [])
}
