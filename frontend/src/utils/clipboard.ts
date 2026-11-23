/** Keep ordinary text paste intact; accept only actual image files from the clipboard. */
export function clipboardImages(data: DataTransfer | null): File[] {
  return Array.from(data?.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}

/** Called from a button click so the browser can ask for clipboard access. */
export async function readClipboardImages(): Promise<File[]> {
  if (!navigator.clipboard?.read) throw new Error('Здесь браузер не поддерживает вставку кнопкой. Используй Ctrl+V или ⌘V.')
  let items: ClipboardItem[]
  try { items = await navigator.clipboard.read() }
  catch { throw new Error('Не удалось прочитать буфер. Разреши доступ в браузере или вставь фото сочетанием Ctrl+V / ⌘V.') }
  const files: File[] = []
  for (const item of items) {
    const type = item.types.find((value) => value.startsWith('image/'))
    if (!type) continue
    const blob = await item.getType(type)
    const ext = type === 'image/jpeg' ? 'jpg' : type.split('/')[1]
    files.push(new File([blob], `Фото из буфера ${files.length + 1}.${ext}`, { type }))
  }
  if (!files.length) throw new Error('В буфере нет изображения. Сначала скопируй фото или снимок экрана.')
  return files
}
