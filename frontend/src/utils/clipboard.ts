/** Keep ordinary text paste intact; accept only actual image files from the clipboard. */
export function clipboardImages(data: DataTransfer | null): File[] {
  return Array.from(data?.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
}
