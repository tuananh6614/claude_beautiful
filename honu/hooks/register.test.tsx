import { expect, test } from 'claude-code/testing'

const BAND = { plugin: 'honu', component: 'AbovePrompt', props: { hasSurvey: false } } as const
const NOW = Date.parse('2026-11-02T08:00:00Z')
const FIVE = { kind: 'five_hour', percentUsed: 31, resetsAt: '2026-11-02T10:30:00Z' }
const WEEK = { kind: 'seven_day', percentUsed: 91, resetsAt: '2026-11-05T18:00:00Z' }
const stored: unknown[] = []

async function start($: any, on: any, rateLimits: unknown[] = [], reading?: unknown) {
  on('command.register', () => ({ value: { command: 'x' } }))
  on('store.get', (_: unknown, e: { key: string }) => ({ value: e.key === 'reading' ? reading : undefined }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    if (e.key === 'reading') stored.push(e.value)
    return { value: undefined }
  })
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => new Promise(() => undefined))
  on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits } }))
  on('ui.render', ($$: any, e: any) => {
    const { Box } = $$.ui.resolve(e)
    return <Box />
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.measure', (_: unknown, e: { changed: string[] }) => ({ changed: e.changed }))
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

async function source($: any) {
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  await ui.unmount()
  return svg?.props.source as string | undefined
}

test('the band says when no reading has come yet', async ($, on) => {
  await start($, on)
  expect(await source($)).toContain('Quota hiện sau')
})

test('the band stays while a survey holds the place above the prompt', async ($, on) => {
  await start($, on, [FIVE])
  const ui = await $.ui.mount({ ...BAND, props: { hasSurvey: true }, surface: 'desktop' })
  const svg = await ui.find({ type: 'Svg' })
  await ui.unmount()
  expect(svg?.props.source).toContain('31%')
})

test('a loaded plugin asks to be drawn, as a write reaches only what is already drawn', async ($, on) => {
  const asked: string[] = []
  on('ui.invalidate', (_: unknown, e: { event: string }) => {
    asked.push(e.event)
    return { value: undefined }
  })
  await start($, on)
  expect(asked).toContain('ui.render')
})

test('a reading shows the plan, the percent and the time left', async ($, on) => {
  await start($, on)
  await $.session.measure({ context: {}, rateLimits: [FIVE, WEEK], changed: ['rateLimits'] })
  await $.command.run({ command: 'quota', args: 'goi Max 5x' })
  const svg = await source($)
  expect(svg).toContain('Max 5x')
  expect(svg).toContain('31%')
  expect(svg).toContain('5 giờ · còn 2g30')
  // 91 % fills the bar in the warning colour.
  expect(svg).toContain('#ff5a5f')
})

test('a pace that will not last until the reset says when the quota runs out', async ($, on) => {
  await start($, on, [FIVE, WEEK])
  const svg = await source($)
  // 91 % in 86 of 168 hours leaves 9 %, which lasts 8 h 31 at that pace, before the 82 hours left.
  expect(svg).toContain('7 ngày · hết sau 8g31')
  expect(svg).not.toContain('5 giờ · hết sau')
})

test('the first tenth of a window draws the pace but gives no warning', async ($, on) => {
  await start($, on, [{ ...FIVE, percentUsed: 50, resetsAt: '2026-11-02T12:50:00Z' }])
  const svg = await source($)
  expect(svg).toContain('5 giờ · còn 4g50')
  expect(svg).toContain('<g transform="rotate(')
})

test('a limit with no known window has no pace', async ($, on) => {
  await start($, on, [{ kind: 'spend_limit', percentUsed: 95 }])
  const svg = await source($)
  expect(svg).toContain('Chi tiêu')
  expect(svg).not.toContain('<g transform="rotate(')
  expect(svg).not.toContain('hết sau')
})

test('a reopened app shows the last reading at once and the next one replaces it', async ($, on) => {
  await start($, on, [], [FIVE, WEEK])
  expect(await source($)).toContain('5 giờ · còn 2g30')
  // A measure of the context alone says nothing about the quota.
  await $.session.measure({ context: { percent: 40 }, rateLimits: [], changed: ['context'] })
  expect(await source($)).toContain('5 giờ · còn 2g30')
  stored.length = 0
  await $.session.measure({ context: { percent: 40 }, rateLimits: [{ ...FIVE, percentUsed: 44 }], changed: ['rateLimits'] })
  expect(await source($)).toContain('44%')
  expect(stored).toEqual([[{ ...FIVE, percentUsed: 44 }]])
})

test('a window past its reset shows no figure', async ($, on) => {
  await start($, on, [], [{ ...FIVE, resetsAt: '2026-11-02T07:00:00Z' }, WEEK])
  const svg = await source($)
  expect(svg).toContain('5 giờ · đã đặt lại')
  expect(svg).not.toContain('31%')
  expect(svg).toContain('91%')
})

test('the context fill waits for its reading behind a dash', async ($, on) => {
  await start($, on, [FIVE, WEEK])
  const before = await source($)
  expect(before).toContain('Ngữ cảnh')
  expect(before).toContain('>–<')
  await $.session.measure({ context: { percent: 62 }, rateLimits: [FIVE, WEEK], changed: ['context'] })
  const svg = await source($)
  expect(svg).toContain('62%')
  expect(svg).not.toContain('>–<')
})

test('the band says while Claude works, and a subagent does not end that', async ($, on) => {
  on('turn.start', (_: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  await start($, on, [FIVE])
  const alt = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
    const svg = await ui.find({ type: 'Svg' })
    await ui.unmount()
    return svg?.props.alt as string
  }
  const end = { answer: '', durationMs: 1, isAborted: false, reason: 'answer', turnId: 't' } as const
  expect(await alt()).not.toContain('đang làm việc')
  await $.turn.start({ text: 'x', turnId: 't' })
  expect(await alt()).toContain('đang làm việc')
  await $.turn.complete({ ...end, agentId: 'a' })
  expect(await alt()).toContain('đang làm việc')
  await $.turn.complete(end)
  expect(await alt()).not.toContain('đang làm việc')
})

test('a part of a point rounds up, as the quota is never shown lower than it is', async ($, on) => {
  await start($, on, [{ ...FIVE, percentUsed: 19.4 }])
  expect(await source($)).toContain('20%')
})

test('/quota hides the band', async ($, on) => {
  await start($, on, [FIVE])
  expect(await source($)).toContain('31%')
  expect((await $.command.run({ command: 'quota', args: '' })).text).toContain('tắt')
  expect(await source($)).toBeUndefined()
})

test('/troi copies the sky script and reports a failure', async ($, on) => {
  let code = 0
  let argv: readonly string[] = []
  on('process.run', (_: unknown, e: { argv: readonly string[] }) => {
    argv = e.argv
    return { value: { exitCode: code, stdout: '', stderr: 'hong' } }
  })
  await start($, on)
  expect((await $.command.run({ command: 'troi', args: '' })).text).toContain('Đã chép')
  expect(argv.join(' ')).toContain('pixel-troi.user.js')
  code = 1
  expect((await $.command.run({ command: 'troi', args: '' })).text).toContain('hong')
})

test('/xem explains itself when the sky script is not running', async ($, on) => {
  await start($, on)
  expect((await $.command.run({ command: 'xem', args: '' })).text).toContain('/troi')
})
