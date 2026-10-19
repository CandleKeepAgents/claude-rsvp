import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Mark, Reader, Word } from '../types'
import {
  bar,
  clampWpm,
  DEFAULT_WPM,
  delayMs,
  lastReply,
  markBlock,
  nextSentence,
  pivotColumn,
  place,
  prevSentence,
  replyContaining,
  tokenize,
  WPM_STEP,
} from './lib'

const EMPTY: Reader = { source: '', words: [], pos: 0, isPlaying: false, isOpen: false, wpm: DEFAULT_WPM }
const readers = atom({ plugin: 'rsvp', key: 'readers' } as const, EMPTY)
const marks = atom({ plugin: 'rsvp', key: 'marks' } as const, {})
const active = atom({ plugin: 'rsvp', key: 'active' } as const, '')

// Module values start over on a reload: timers restart from `active` in
// session.start, and replies fill `anchors` again as they are drawn.
let timer: Timer | undefined
const anchors = new Map<string, string>()
const tokenCache = new Map<string, Word[]>()

const wordsOf = (source: string) => {
  let words = tokenCache.get(source)
  if (!words) {
    words = tokenize(source)
    tokenCache.set(source, words)
  }
  return words
}

const stopTimer = () => {
  timer?.cancel()
  timer = undefined
}

const storedWpm = async ($: EngineInterface) => {
  const wpm = await $.store.get('wpm')
  return typeof wpm === 'number' ? clampWpm(wpm) : DEFAULT_WPM
}

const storedAutoOpen = async ($: EngineInterface) => {
  const n = await $.store.get('autoOpen')
  return typeof n === 'number' && n > 0 ? n : 0
}

/** Keeps where a stopped reader is, so the reply shows the mark; drops it at the start or end. */
const saveMark = async ($: EngineInterface, id: string) => {
  const r = await read($, memberOf(readers, { requestId: id }))
  const isMid = r.pos > 0 && r.pos < r.words.length - 1
  await update($, marks, all => {
    const next: Record<string, Mark> = { ...all }
    if (isMid && !r.isPlaying) next[id] = { pos: r.pos, total: r.words.length, source: r.source }
    else delete next[id]
    return next
  })
}

const schedule = async ($: EngineInterface, id: string) => {
  stopTimer()
  const r = await read($, memberOf(readers, { requestId: id }))
  if (!r.isPlaying) return
  if (r.pos >= r.words.length - 1) {
    await update($, memberOf(readers, { requestId: id }), s => ({ ...s, isPlaying: false }))
    await update($, active, () => '')
    await saveMark($, id)
    return
  }
  timer = $.clock.after(delayMs(r.words[r.pos], r.wpm), () => void step($, id))
}

const step = async ($: EngineInterface, id: string) => {
  if ((await read($, active)) !== id) return
  await update($, memberOf(readers, { requestId: id }), s => ({ ...s, pos: Math.min(s.pos + 1, s.words.length - 1) }))
  await schedule($, id)
}

const pause = async ($: EngineInterface, id: string) => {
  stopTimer()
  await update($, memberOf(readers, { requestId: id }), s => ({ ...s, isPlaying: false }))
  await update($, active, a => (a === id ? '' : a))
  await saveMark($, id)
}

/** One reader plays at a time: starting one stops the other where it is. */
const play = async ($: EngineInterface, id: string) => {
  const other = await read($, active)
  if (other && other !== id) await pause($, other)
  await update($, memberOf(readers, { requestId: id }), s => ({
    ...s,
    isPlaying: s.words.length > 0,
    isOpen: true,
    pos: s.pos >= s.words.length - 1 ? 0 : s.pos,
  }))
  await update($, active, () => id)
  await saveMark($, id)
  await schedule($, id)
}

const toggle = async ($: EngineInterface, id: string) =>
  (await read($, memberOf(readers, { requestId: id }))).isPlaying ? pause($, id) : play($, id)

const openReader = async ($: EngineInterface, id: string, source: string, from: 'start' | 'mark') => {
  const mark = (await read($, marks))[id]
  const words = wordsOf(source)
  const pos = from === 'mark' && mark && mark.total === words.length ? mark.pos : 0
  const wpm = await storedWpm($)
  await update($, memberOf(readers, { requestId: id }), () => ({ source, words, pos, isPlaying: false, isOpen: true, wpm }))
  await play($, id)
}

const close = async ($: EngineInterface, id: string) => {
  await pause($, id)
  await update($, memberOf(readers, { requestId: id }), s => ({ ...s, isOpen: false }))
}

const seek = async ($: EngineInterface, id: string, to: (r: Reader) => number) => {
  const r = await update($, memberOf(readers, { requestId: id }), s => ({ ...s, pos: to(s) }))
  if (r.isPlaying) await schedule($, id)
  else await saveMark($, id)
}

const setWpm = async ($: EngineInterface, id: string, by: number) => {
  const r = await update($, memberOf(readers, { requestId: id }), s => ({ ...s, wpm: clampWpm(s.wpm + by) }))
  await $.store.set('wpm', r.wpm)
}

/** The drawn reply whose first block opens `source`. */
const anchorOf = (source: string) => {
  let best: { id: string; at: number } | undefined
  for (const [id, text] of anchors) {
    const at = source.indexOf(text.trim().slice(0, 200))
    if (at >= 0 && (!best || at < best.at)) best = { id, at }
  }
  return best?.id
}

const openLast = async ($: EngineInterface) => {
  const source = lastReply(await $.session.messages())
  const id = source ? anchorOf(source) : undefined
  if (!id) return 0
  await openReader($, id, source, 'mark')
  return wordsOf(source).length
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rsvp',
      description: "Speed-read Claude's last reply under it. /rsvp 400 sets the speed, /rsvp auto 150 opens it after long replies, /rsvp auto off stops that",
      argumentHint: '[wpm | auto <words>|off]',
    })
    const id = await read($, active)
    if (id) void schedule($, id)
    return next(e)
  })

  on('command.run', { command: 'rsvp' }, async ($, e) => {
    const [first, second] = e.args.trim().toLowerCase().split(/\s+/)

    if (first === 'auto') {
      const n = Number(second)
      const words = second === 'off' || !Number.isFinite(n) || n <= 0 ? 0 : Math.round(n)
      await $.store.set('autoOpen', words)
      return { text: words ? `Opens by itself after replies of ${words}+ words.` : 'Opens only when you ask.' }
    }

    if (first && Number.isFinite(Number(first))) {
      await $.store.set('wpm', clampWpm(Number(first)))
    }

    const count = await openLast($)
    if (!count) return { text: 'No reply to read here. Click ▶ speed-read under a reply.' }
    return { text: `Reading ${count} words under the reply at ${await storedWpm($)} wpm.` }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const min = await storedAutoOpen($)
    if (min) {
      // the reply's first block is drawn, and so registered, just after the turn
      $.clock.after(800, () => {
        void (async () => {
          const source = lastReply(await $.session.messages())
          if (wordsOf(source).length >= min) await openLast($)
        })()
      })
    }
    return result
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // a fixed-width word line needs a monospace face: the terminal, or the desktop's `mono`
    if (e.props.isSummary || (e.surface !== 'terminal' && e.surface !== 'desktop')) return next(e)

    // the stop mark, in whichever block of its reply the word lies
    let text = e.props.text
    for (const mark of Object.values(await read($, marks))) {
      if (mark.source.includes(text.trim().slice(0, 200))) {
        text = markBlock(text, mark.source, wordsOf(mark.source), mark.pos)
        break
      }
    }
    const own = await next(text === e.props.text ? e : { ...e, props: { ...e.props, text } })
    if (!e.props.isFirstOfReply) return own

    const id = e.requestId
    anchors.set(id, e.props.text)
    const { Box, Text, Button } = $.ui.resolve(e)
    const r = await read($, memberOf(readers, { requestId: id }))
    const mark = (await read($, marks))[id]
    const source = async () => replyContaining(await $.session.messages(), e.props.text)

    if (!r.isOpen) {
      return (
        <Box flexDirection="column">
          {own}
          <Box key={`${id}:bar`} flexDirection="row" paddingLeft={2} columnGap={2}>
            {mark && (
              <Button key={`${id}:resume`} plain dimColor label={`▶ resume speed-read at ${mark.pos + 1}/${mark.total}`} onPress={async () => openReader($, id, await source(), 'mark')} />
            )}
            {mark && (
              <Button key={`${id}:fromstart`} plain dimColor label="⏮ from the start" onPress={async () => openReader($, id, await source(), 'start')} />
            )}
            {!mark && (
              <Button key={`${id}:open`} plain dimColor label="▶ speed-read" onPress={async () => openReader($, id, await source(), 'start')} />
            )}
          </Box>
        </Box>
      )
    }

    const cols = Math.max(20, Math.min((e.viewport?.columns ?? 80) - 4, 50))
    const word = r.words[r.pos] ?? r.words[0]
    const at = place(word?.t ?? '', cols)
    const col = pivotColumn(cols)
    const rule = (m: string) => '┄'.repeat(col) + m + '┄'.repeat(Math.max(0, cols - col - 1))
    const state = r.isPlaying ? 'playing' : r.pos >= r.words.length - 1 ? 'end' : 'stopped'

    return (
      <Box flexDirection="column">
        {own}
        <Box key={`${id}:reader`} flexDirection="column" paddingLeft={2} marginTop={1}>
          <Text mono dimColor>{rule('┬')}</Text>
          <Text key={`${id}:word`} mono bold wrap="truncate">
            {at.pad}
            {at.left}
            <Text color="error">{at.pivot}</Text>
            {at.right}
          </Text>
          <Text mono dimColor>{rule('┴')}</Text>
          <Text key={`${id}:progress`} mono wrap="truncate">
            <Text color="claude">{bar(r.pos, r.words.length, cols)}</Text>
            <Text dimColor>
              {' '}
              {r.pos + 1}/{r.words.length} · {r.wpm} wpm · {state}
            </Text>
          </Text>
          <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
            <Button key={`${id}:play`} label={r.isPlaying ? '⏸ stop' : '▶ play'} onPress={() => toggle($, id)} />
            <Button key={`${id}:back`} label="◀ sentence" onPress={() => seek($, id, s => prevSentence(s.words, s.pos))} />
            <Button key={`${id}:next`} label="sentence ▶" onPress={() => seek($, id, s => nextSentence(s.words, s.pos))} />
            <Button key={`${id}:slower`} label="− slower" onPress={() => setWpm($, id, -WPM_STEP)} />
            <Button key={`${id}:faster`} label="+ faster" onPress={() => setWpm($, id, WPM_STEP)} />
            <Button key={`${id}:restart`} label="⏮" onPress={() => seek($, id, () => 0)} />
            <Button key={`${id}:close`} label="✕ close" onPress={() => close($, id)} />
          </Box>
        </Box>
      </Box>
    )
  })
}
