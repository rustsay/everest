import { useEffect, useState } from 'react'
import { getPushSettings, pushSubscribe, pushTest, pushUnsubscribe, putPushSettings } from '../api/client'
import { useApp } from '../app/store'
import { Icon } from '../design/ui'
import type { PushSettings } from '../types'
import { canPrompt, isIos, isStandalone, onPwaChange, promptInstall, pushState, PushState, subscribePush, unsubscribePush } from '../pwa'

/** In the profile: install the site on the phone and turn push notifications on or off. */
export default function PhonePush() {
  const { me, toast } = useApp()
  const [st, setSt] = useState<PushState | null>(null)
  const [ps, setPs] = useState<PushSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)

  useEffect(() => onPwaChange(() => setTick((t) => t + 1)), [])
  useEffect(() => {
    pushState().then(setSt).catch(() => setSt('unsupported'))
    if (!me.is_demo) getPushSettings().then(setPs).catch(() => null)
  }, [me.is_demo])

  const run = async (f: () => Promise<void>) => {
    setBusy(true)
    try { await f() } catch (e) { toast(String(e).replace('Error: ', '')) } finally { setBusy(false) }
  }
  const turnOn = () => run(async () => {
    if (!ps?.key) throw new Error('Сервер пока не готов отправлять уведомления')
    const sub = await subscribePush(ps.key)
    setPs(await pushSubscribe(sub))
    setSt('on')
    toast('Уведомления включены')
  })
  const turnOff = () => run(async () => {
    const ep = await unsubscribePush()
    if (ep) setPs(await pushUnsubscribe(ep))
    setSt('off')
    toast('Уведомления на этом устройстве выключены')
  })
  const test = () => run(async () => { await pushTest(); toast('Отправлено. Уведомление придёт через пару секунд') })
  const remind = () => run(async () => { if (ps) setPs(await putPushSettings(!ps.remind)) })

  const installed = isStandalone()
  return (
    <>
      <span className="flabel" style={{ marginTop: 16, display: 'block' }}>Телефон и уведомления</span>
      {!installed && (
        <div style={{ marginBottom: 10 }}>
          {canPrompt() ? (
            <button className="btn btn-sm btn-em" onClick={() => promptInstall().then((ok) => ok && toast('Эверест установлен'))}><Icon n="home" s={16} />Установить на это устройство</button>
          ) : (
            <p className="muted" style={{ fontSize: 13.5 }}>
              {isIos()
                ? 'Чтобы Эверест открывался со значка, как приложение: в Safari нажмите «Поделиться», затем «На экран "Домой"».'
                : 'Чтобы Эверест открывался со значка, как приложение: в меню браузера выберите «Установить приложение» или «Добавить на главный экран».'}
            </p>
          )}
        </div>
      )}
      {me.is_demo ? <p className="muted" style={{ fontSize: 13.5 }}>В демо уведомления не включаются.</p>
        : st === null ? null
        : st === 'insecure' ? <p className="muted" style={{ fontSize: 13.5 }}>Уведомления работают только на сайте с https. Сейчас сайт открыт без защищённого соединения.</p>
        : st === 'ios-install' ? <p className="muted" style={{ fontSize: 13.5 }}>На iPhone уведомления включаются после установки: добавьте Эверест на экран «Домой», откройте его со значка и включите уведомления здесь.</p>
        : st === 'unsupported' ? <p className="muted" style={{ fontSize: 13.5 }}>Этот браузер не умеет показывать уведомления.</p>
        : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {st === 'on' ? (
              <>
                <span className="pill p-em"><Icon n="bell" s={14} /> Уведомления включены</span>
                <button className="btn btn-sm btn-ghost" disabled={busy} onClick={test}>Проверить</button>
                <button className="btn btn-sm btn-ghost" disabled={busy} onClick={turnOff}>Выключить здесь</button>
                {ps?.student && (
                  <button className={`btn btn-sm ${ps.remind ? 'btn-em' : 'btn-ghost'}`} disabled={busy} onClick={remind}>
                    <Icon n="clock" s={16} />Напоминать о занятиях в {ps.time}: {ps.remind ? 'вкл' : 'выкл'}
                  </button>
                )}
              </>
            ) : (
              <button className="btn btn-sm btn-em" disabled={busy} onClick={turnOn}><Icon n="bell" s={16} />Включить уведомления</button>
            )}
            {st === 'denied' && <p className="muted" style={{ fontSize: 13, width: '100%' }}>Уведомления запрещены в настройках браузера для этого сайта. Разрешите их там и нажмите «Включить уведомления».</p>}
            {st !== 'on' && <p className="muted" style={{ fontSize: 13, width: '100%' }}>Сюда будут приходить те же уведомления, что под колокольчиком{me.role === 'student' ? ', и напоминание в дни занятий, если ты ещё не занимался' : ''}.</p>}
          </div>
        )}
    </>
  )
}
