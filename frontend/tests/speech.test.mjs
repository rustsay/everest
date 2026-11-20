import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/utils/speech.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText
const { speak, hush, prepareSpeech, setSpeechRate } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))

const players = [], revoked = [], errors = []
globalThis.Audio = class {
  constructor() { players.push(this) }
  play() { this.started = true; return Promise.resolve() }
  pause() { this.paused = true }
  removeAttribute() {}
  setAttribute() {}
  remove() {}
  load() {}
}
globalThis.localStorage = { getItem: () => 'qa-token' }
globalThis.window = { dispatchEvent: (event) => errors.push(event.type) }
globalThis.document = { body: { appendChild() {} } }
URL.createObjectURL = () => 'blob:qa-' + players.length
URL.revokeObjectURL = (url) => revoked.push(url)
const tick = () => new Promise((resolve) => setImmediate(resolve))
const ok = { ok: true, blob: async () => new Blob(['mp3']) }

test('shared narration: authentication, speed, completion and URL cleanup', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/speech')
    assert.equal(init.headers.Authorization, 'Bearer qa-token')
    assert.equal(JSON.parse(init.body).text, 'Привет')
    return ok
  }
  const done = speak('Привет', 1.5)
  await tick()
  assert.equal(players.at(-1).playbackRate, 1.5)
  assert.equal(players.at(-1).started, true)
  players.at(-1).onended()
  assert.equal(await done, 'ended')
  assert.equal(revoked.length, 1)
})

test('stopping a pending request cannot start stale audio later', async () => {
  let release, signal
  globalThis.fetch = (_, init) => { signal = init.signal; return new Promise((resolve) => { release = resolve }) }
  const done = speak('Первый')
  const old = players.at(-1)
  hush()
  assert.equal(await done, 'cancelled')
  assert.equal(signal.aborted, false) // Download stays reusable by prefetch/replay.
  release(ok)
  await tick()
  assert.equal(old.started, undefined)
})

test('new narration interrupts old playback; hush stops the new one', async () => {
  globalThis.fetch = async () => ok
  const first = speak('Первый')
  await tick()
  const old = players.at(-1)
  const second = speak('Второй')
  assert.equal(await first, 'cancelled')
  assert.equal(old.paused, true)
  await tick()
  hush()
  assert.equal(await second, 'cancelled')
})

test('service and browser playback errors resolve and notify without another voice', async () => {
  globalThis.fetch = async () => ({ ok: false })
  assert.equal(await speak('Ошибка сервиса'), 'error')
  globalThis.fetch = async () => ok
  const done = speak('Ошибка проигрывателя')
  await tick()
  players.at(-1).onerror()
  assert.equal(await done, 'error')
  assert.deepEqual(errors, ['voice-error', 'voice-error'])
})

test('prefetch and playback share a download; cached replay needs no network', async () => {
  let release, calls = 0, started = 0
  globalThis.fetch = () => { calls++; return new Promise((resolve) => { release = resolve }) }
  const prepared = prepareSpeech('Следующий шаг')
  const done = speak('Следующий шаг', 1, () => { started++ })
  assert.equal(calls, 1)
  assert.equal(started, 0)
  release(ok)
  await prepared; await tick()
  assert.equal(started, 1)
  players.at(-1).onended()
  assert.equal(await done, 'ended')
  const replay = speak('Следующий шаг')
  await tick()
  assert.equal(calls, 1)
  hush()
  assert.equal(await replay, 'cancelled')
})

test('changing speed updates the current clip without restarting it', async () => {
  globalThis.fetch = async () => ok
  const done = speak('Меняем скорость')
  await tick()
  const current = players.at(-1), count = players.length
  setSpeechRate(2)
  assert.equal(current.playbackRate, 2)
  assert.equal(players.length, count)
  assert.equal(current.paused, undefined)
  hush()
  assert.equal(await done, 'cancelled')
})

test('browser autoplay restrictions request a click without reporting provider failure', async () => {
  globalThis.fetch = async () => ok
  const play = Audio.prototype.play
  Audio.prototype.play = () => Promise.reject(new DOMException('Click required', 'NotAllowedError'))
  const before = errors.length
  assert.equal(await speak('Включите звук'), 'blocked')
  assert.equal(errors.length, before)
  Audio.prototype.play = play
})

test('dismissing an old mascot bubble cannot stop board narration', async () => {
  globalThis.fetch = async () => ok
  const done = speak('Голос разбора', 1, undefined, 'board')
  await tick()
  const current = players.at(-1)
  hush('mascot')
  assert.equal(current.paused, undefined)
  assert.equal(current.started, true)
  hush('board')
  assert.equal(await done, 'cancelled')
})
