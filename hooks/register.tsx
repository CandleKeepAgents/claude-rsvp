import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Reader } from '../types'
import {
  bar,
  clampWpm,
  DEFAULT_WPM,
  delayMs,
  lastReply,
  nextSentence,
  pivotColumn,
  place,
  prevSentence,
  replyContaining,
  tokenize,
  WPM_STEP,
} from './lib'

const PANE = 'rsvp'
const EMPTY: Reader = { words: [], pos: 0, isPlaying: false, wpm: DEFAULT_WPM }
const reader = atom({ plugin: 'rsvp', key: 'reader' } as const, EMPTY)

// Timers die with the module on a reload; session.start restarts a playing reader.
let timer: Timer | undefined

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

const schedule = async ($: EngineInterface) => {
  stopTimer()
  const r = await read($, reader)
  if (!r.isPlaying) return
  if (r.pos >= r.words.length - 1) {
    await update($, reader, s => ({ ...s, isPlaying: false }))
    return
  }
  timer = $.clock.after(delayMs(r.words[r.pos], r.wpm), () => void step($))
}

const step = async ($: EngineInterface) => {
  const isOpen = (await $.ui.panes()).some(p => p.id === PANE)
  if (!isOpen) {
    await update($, reader, s => ({ ...s, isPlaying: false }))
    return
  }
  await update($, reader, s => ({ ...s, pos: Math.min(s.pos + 1, s.words.length - 1) }))
  await schedule($)
}

const openPane = ($: EngineInterface) =>
  $.ui.open({ id: PANE, title: 'Speed read', focus: true, closeOnEscape: true, rows: 7, columns: 40 })

const start = async ($: EngineInterface, text: string) => {
  const words = tokenize(text)
  const wpm = await storedWpm($)
  await update($, reader, () => ({ words, pos: 0, isPlaying: words.length > 0, wpm }))
  await openPane($)
  await schedule($)
  return words.length
}

const togglePlay = async ($: EngineInterface) => {
  await update($, reader, s => {
    const atEnd = s.pos >= s.words.length - 1
    return { ...s, isPlaying: !s.isPlaying, pos: !s.isPlaying && atEnd ? 0 : s.pos }
  })
  await schedule($)
}

const seek = async ($: EngineInterface, to: (r: Reader) => number) => {
  await update($, reader, s => ({ ...s, pos: to(s) }))
  await schedule($)
}

const setWpm = async ($: EngineInterface, by: number) => {
  const r = await update($, reader, s => ({ ...s, wpm: clampWpm(s.wpm + by) }))
  await $.store.set('wpm', r.wpm)
  // the word on screen keeps its old timing; the next one uses the new speed
}

const readLast = async ($: EngineInterface) => start($, lastReply(await $.session.messages()))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'rsvp',
      description: "Speed-read Claude's last reply. /rsvp 400 sets the speed, /rsvp auto 150 opens it after long replies, /rsvp auto off stops that",
      argumentHint: '[wpm | auto <words>|off]',
    })
    void schedule($)
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

    const count = await readLast($)
    if (!count) return { text: 'No reply to read yet.' }
    return { text: `Reading ${count} words at ${await storedWpm($)} wpm. p play/pause · b/n sentence · s/f speed · r restart · Esc close.` }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    const min = await storedAutoOpen($)
    if (min) {
      const text = lastReply(await $.session.messages())
      if (tokenize(text).length >= min) void start($, text)
    }
    return result
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      stopTimer()
      await update($, reader, s => ({ ...s, isPlaying: false })).catch(() => undefined)
    }
    return next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const own = await next(e)
    if (!e.props.isFirstOfReply || e.props.isSummary || e.surface !== 'terminal') return own

    const { Box, Button } = $.ui.resolve(e)
    const block = e.props.text
    return (
      <Box flexDirection="column">
        {own}
        <Box key={`rsvp-${e.requestId}`} paddingLeft={2}>
          <Button
            key={`rsvp-read-${e.requestId}`}
            plain
            dimColor
            label="▶ speed-read"
            onPress={async () => {
              await start($, replyContaining(await $.session.messages(), block))
            }}
          />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const r = await read($, reader)
    const cols = Math.max(12, e.props.bodyColumns)

    if (r.words.length === 0) {
      return <Text dimColor>Nothing to read yet. Run /rsvp after a reply.</Text>
    }

    const word = r.words[r.pos] ?? r.words[0]!
    const at = place(word.t, cols)
    const col = pivotColumn(cols)
    const rule = (mark: string) => '─'.repeat(col) + mark + '─'.repeat(Math.max(0, cols - col - 1))
    const state = r.isPlaying ? '▶' : r.pos >= r.words.length - 1 ? 'end' : 'paused'

    return (
      <Box flexDirection="column">
        <Text dimColor>{rule('┬')}</Text>
        <Text bold wrap="truncate">
          {at.pad}
          {at.left}
          <Text color="error">{at.pivot}</Text>
          {at.right}
        </Text>
        <Text dimColor>{rule('┴')}</Text>
        <Text color="claude" wrap="truncate">
          {bar(r.pos, r.words.length, cols)}
        </Text>
        <Text dimColor wrap="truncate">
          {r.pos + 1}/{r.words.length} · {r.wpm} wpm · {state}
        </Text>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          <Button key="play" plain hotkey="p" label={r.isPlaying ? '⏸' : '▶'} onPress={() => togglePlay($)} />
          <Button key="back" plain hotkey="b" label="◀" onPress={() => seek($, s => prevSentence(s.words, s.pos))} />
          <Button key="next" plain hotkey="n" label="▶▶" onPress={() => seek($, s => nextSentence(s.words, s.pos))} />
          <Button key="slower" plain hotkey="s" label="−" onPress={() => setWpm($, -WPM_STEP)} />
          <Button key="faster" plain hotkey="f" label="+" onPress={() => setWpm($, WPM_STEP)} />
          <Button key="restart" plain hotkey="r" label="⏮" onPress={() => seek($, () => 0)} />
        </Box>
      </Box>
    )
  })
}
