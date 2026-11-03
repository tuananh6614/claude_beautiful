import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Limit, Prefs } from '../types'

const STORE_KEY = 'prefs'
const READING_KEY = 'reading'
const LONG_TURN_MS = 15000
const RING = 47.1

const limits = atom({ plugin: 'honu', key: 'limits' } as const, [])
const now = atom({ plugin: 'honu', key: 'now' } as const, 0)
const prefs = atom({ plugin: 'honu', key: 'prefs' } as const, { band: true, sound: true, plan: '' })
const working = atom({ plugin: 'honu', key: 'working' } as const, false)
const fill = atom({ plugin: 'honu', key: 'fill' } as const, null)

const LABEL: Record<string, string> = { five_hour: '5 giờ', seven_day: '7 ngày', spend_limit: 'Chi tiêu', context: 'Ngữ cảnh' }
const WINDOW: Record<string, number> = { five_hour: 5 * 3600e3, seven_day: 7 * 864e5 }
const pad = (n: number) => String(n).padStart(2, '0')
// A path inside a single-quoted PowerShell string.
const ps = (path: string) => path.replace(/'/g, "''")
// DevTools stay shut until Developer Mode is on, and a fresh Console blocks the first paste.
const FIRST_TIME = 'Không mở được thì bật Help > Troubleshooting > Enable Developer Mode trước. Lần đầu, nếu Console báo chặn dán, gõ allow pasting, Enter rồi dán lại.'

function remaining(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60000))
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days) return `${days}n${hours}g`
  return hours ? `${hours}g${pad(minutes % 60)}` : `${minutes}p`
}

function block(x: number, limit: Limit, at: number): string {
  const left = limit.resetsAt ? Date.parse(limit.resetsAt) - at : 0
  // Past its reset, or not read yet: there is no figure to show.
  const over = limit.resetsAt !== undefined && left <= 0
  const known = !over && !Number.isNaN(limit.percentUsed)
  const pct = known ? Math.min(100, limit.percentUsed) : 0
  const color = pct >= 85 ? '#ff5a5f' : pct >= 60 ? '#ffc24b' : '#ffffff'
  const label = (LABEL[limit.kind] ?? limit.kind).replace(/[<&]/g, '')
  const arc = pct > 0 ? Math.max(1, (pct / 100) * RING) : 0
  const span = WINDOW[limit.kind] ?? 0
  // How much of the window has gone, and how long the quota lasts at this pace.
  const gone = span && left > 0 ? Math.max(0, 1 - left / span) : 0
  const lasts = pct ? ((100 - pct) / pct) * gone * span : Infinity
  // Early in a window the pace says nothing yet.
  const short = gone >= 0.1 && pct >= 10 && pct < 100 && lasts < left
  const tail = over ? ' · đã đặt lại' : short ? ` · hết sau ${remaining(lasts)}` : limit.resetsAt ? ` · còn ${remaining(left)}` : ''
  const tick = gone
    ? `<g transform="rotate(${(gone * 360).toFixed(1)} ${x + 8} 18)"><path d="M${x + 8} 7.2v5.6" stroke="#232327" stroke-width="3.4"/><path d="M${x + 8} 7.6v4.8" stroke="#ffffff" stroke-width="1.7" stroke-linecap="round"/></g>`
    : ''

  return (
    `<circle cx="${x + 8}" cy="18" r="7.5" fill="none" stroke="#ffffff" stroke-opacity=".2" stroke-width="2.6"/>` +
    `<circle cx="${x + 8}" cy="18" r="7.5" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round" stroke-dasharray="${arc.toFixed(1)} ${RING}" transform="rotate(-90 ${x + 8} 18)"/>${tick}` +
    `<text x="${x + 25}" y="22.5" fill="#ffffff" font-size="14" font-weight="600">${known ? `${Math.ceil(limit.percentUsed)}%` : '–'}</text>` +
    `<text x="${x + 63}" y="22" fill="${short ? '#ffc24b' : '#ffffff'}" fill-opacity="${short ? 1 : 0.62}">${label}${tail}</text>`
  )
}

// The right end stays empty: the sky script sets its button there. The third column
// starts later because the second holds the longest text on the band.
function scene(list: readonly Limit[], at: number, plan: string): string {
  const body = list.length
    ? list.map((limit, i) => block(66 + i * 182 + (i > 1 ? 16 : 0), limit, at)).join('')
    : '<text x="66" y="22" fill="#ffffff" fill-opacity=".62">Quota hiện sau câu trả lời đầu tiên của phiên</text>'

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="36" viewBox="0 0 600 36" font-family="-apple-system, SF Pro Text, Segoe UI Variable Text, Segoe UI, sans-serif" font-size="12.5" text-rendering="geometricPrecision">` +
    `<rect width="600" height="36" rx="18" fill="#2b2b30" fill-opacity=".6"/>` +
    `<rect x=".5" y=".5" width="599" height="35" rx="17.5" fill="none" stroke="#ffffff" stroke-opacity=".16"/>` +
    `<text x="19" y="22.5" fill="#ffffff" font-size="14" font-weight="600">${plan.replace(/[<&"]/g, '') || 'Claude'}</text>${body}</svg>`
  )
}

function restore(saved: unknown): Prefs {
  const s = (saved && typeof saved === 'object' ? saved : {}) as Partial<Prefs>
  return { band: s.band !== false, sound: s.sound !== false, plan: typeof s.plan === 'string' ? s.plan : '' }
}

export const register: Register = on => {
  let startedAt = 0
  let tick: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const saved = await $.store.get(STORE_KEY)
    if (saved !== undefined) await update($, prefs, () => restore(saved))
    // The app has no reading until its first answer, so the last one shows meanwhile.
    const first = await $.clock.now()
    await update($, now, () => first)
    const reading = await $.store.get(READING_KEY)
    if (Array.isArray(reading)) await update($, limits, () => reading)
    await $.command.register({
      name: 'quota',
      description: 'Bảng quota: /quota bật/tắt bảng, /quota am bật/tắt tiếng báo, /quota goi Max ghi tên gói',
      argumentHint: '[am | goi <tên gói>]',
    })
    await $.command.register({
      name: 'troi',
      description: 'Chép script nền Bầu trời vào clipboard để dán vào Console',
    })
    await $.command.register({
      name: 'xem',
      description: 'Xem lần lượt mọi buổi, mọi kiểu thời tiết và các pha trăng',
    })
    const started = await next(e)
    const { rateLimits, context } = await $.session.usage()
    if (rateLimits.length) await update($, limits, () => rateLimits)
    await update($, fill, () => context.percent ?? null)
    tick?.cancel()
    tick = $.clock.every(30000, () => {
      void $.clock.now().then(t => update($, now, () => t))
    })
    // A write redraws only what has been drawn, and a reloaded plugin has drawn nothing yet.
    $.ui.invalidate('ui.render')

    return started
  })

  on('session.measure', async ($, e, next) => {
    if (e.rateLimits.length) {
      await update($, limits, () => e.rateLimits)
      if (e.changed.includes('rateLimits')) await $.store.set(READING_KEY, e.rateLimits)
    }
    await update($, fill, () => e.context.percent ?? null)

    return next(e)
  })

  on('command.run', { command: 'quota' }, async ($, e) => {
    const plan = /^goi\s+(.{1,10})$/i.exec(e.args.trim())?.[1]
    if (plan) {
      let saved = await read($, prefs)
      await update($, prefs, p => (saved = { ...p, plan }))
      await $.store.set(STORE_KEY, saved)

      return { text: `Tên gói: ${plan}.` }
    }
    const key = e.args.trim().toLowerCase() === 'am' ? 'sound' : 'band'
    let out = await read($, prefs)
    await update($, prefs, p => (out = { ...p, [key]: !p[key] }))
    await $.store.set(STORE_KEY, out)

    return { text: `${key === 'sound' ? 'Tiếng báo' : 'Bảng quota'}: ${out[key] ? 'bật' : 'tắt'}.` }
  })

  on('command.run', { command: 'troi' }, async $ => {
    const script = `${$.plugin.root}/pixel-troi.user.js`
    const copy = `Set-Clipboard -Value ([IO.File]::ReadAllText('${ps(script)}',[Text.Encoding]::UTF8))`
    const win = await $.process.run(['powershell', '-NoProfile', '-Command', copy]).catch(() => null)
    if (win?.exitCode === 0) return { text: `Đã chép nền Bầu trời. Nhấn Ctrl+Alt+I (hoặc Ctrl+Shift+I), chọn Console, nhấn Ctrl+V rồi Enter. ${FIRST_TIME}` }
    const mac = await $.process.run(['sh', '-c', 'pbcopy < "$1"', 'sh', script]).catch(() => null)
    if (mac?.exitCode === 0) return { text: `Đã chép nền Bầu trời. Nhấn Cmd+Option+I, chọn Console, nhấn Cmd+V rồi Enter. ${FIRST_TIME}` }

    return { text: `Chưa chép được script: ${(win?.stderr ?? 'không có công cụ chép').trim()}` }
  })

  // While the sky script runs it answers /xem itself, before this is reached.
  on('command.run', { command: 'xem' }, async () => ({
    text: 'Nền chưa chạy: gõ /troi rồi dán vào Console. Khi nền đã chạy, gõ /xem và nhấn Enter, hoặc nhấn Alt+T rồi bấm Xem tất cả.',
  }))

  on('prompt.submit', ($, e, next) => {
    startedAt = Date.now()

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) await update($, working, () => true)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) await update($, working, () => false)
    const p = await read($, prefs)
    if (e.reason === 'answer' && p.sound && Date.now() - startedAt >= LONG_TURN_MS) {
      void $.process
        .run(['powershell', '-NoProfile', '-Command', `(New-Object Media.SoundPlayer '${ps($.plugin.root)}/sounds/done.wav').PlaySync()`])
        .catch(() => $.audio.play({ asset: 'sounds/done.wav' }).catch(() => undefined))
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // A survey does not take the band's place: `others` holds it, above the quota.
    if (e.surface === 'terminal') return next(e)
    const p = await read($, prefs)
    if (!p.band) return next(e)
    const quota = (await read($, limits)).slice(0, 2)
    const context = await read($, fill)
    const list = quota.length || context !== null ? [...quota, { kind: 'context', percentUsed: context ?? Number.NaN }] : []
    const at = await read($, now)
    const busy = await read($, working)
    const { Box, Svg } = $.ui.resolve(e)
    const others = await next(e)
    const alt = list.filter(l => !Number.isNaN(l.percentUsed)).map(l => `${LABEL[l.kind] ?? l.kind} đã dùng ${Math.ceil(l.percentUsed)}%`).join(', ')
    // The sky script finds the band by this first word, and sees the work by the last one.

    return (
      <Box flexDirection="column">
        {others}
        <Svg source={scene(list, at, p.plan)} alt={`Quota ${p.plan}. ${alt || 'Chưa có số quota'}${busy ? '. Claude đang làm việc' : ''}`} height={36} />
      </Box>
    )
  })
}
