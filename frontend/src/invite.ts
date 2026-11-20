/** Invite link of a class: https://site/?join=CODE. The code is kept until the student signs in, then the app joins the class. */
const KEY = 'invite'

;(() => {
  try {
    const u = new URL(location.href)
    const c = (u.searchParams.get('join') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
    if (!c) return
    localStorage.setItem(KEY, c)
    u.searchParams.delete('join')
    history.replaceState(null, '', u.pathname + u.search + u.hash)
  } catch { /* storage is off: the student can still type the code */ }
})()

export const pendingInvite = (): string | null => { try { return localStorage.getItem(KEY) } catch { return null } }
export const clearInvite = () => { try { localStorage.removeItem(KEY) } catch { /* ignore */ } }
export const inviteLink = (code: string) => `${location.origin}/?join=${encodeURIComponent(code)}`
