import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/utils/clipboard.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText
const { clipboardImages, readClipboardImages } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
const clipboard = (read) => Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: read ? { read } : undefined } })

test('clipboard button reads images and ignores text entries', async () => {
  const blob = new Blob(['image'], { type: 'image/png' })
  clipboard(async () => [
    { types: ['text/plain'], getType: () => { throw new Error('Text must not be read') } },
    { types: ['image/png'], getType: async () => blob },
  ])
  const files = await readClipboardImages()
  assert.equal(files.length, 1)
  assert.equal(files[0].type, 'image/png')
  assert.equal(files[0].name, 'Фото из буфера 1.png')
  assert.equal(await files[0].text(), 'image')
})

test('empty clipboard and denied access have actionable messages', async () => {
  clipboard(async () => [])
  await assert.rejects(readClipboardImages(), /В буфере нет изображения/)
  clipboard(async () => { throw new Error('NotAllowedError') })
  await assert.rejects(readClipboardImages(), /Разреши доступ.*Ctrl\+V/)
  clipboard()
  await assert.rejects(readClipboardImages(), /не поддерживает.*Ctrl\+V/)
})

test('keyboard paste accepts images while ordinary text is left alone', () => {
  const photo = new File(['photo'], 'photo.png', { type: 'image/png' })
  assert.deepEqual(clipboardImages({ items: [{ kind: 'string', type: 'text/plain' }] }), [])
  assert.deepEqual(clipboardImages({ items: [{ kind: 'file', type: 'image/png', getAsFile: () => photo }] }), [photo])
  assert.deepEqual(clipboardImages(null), [])
})
