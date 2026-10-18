import type { Word } from '../types'

export const MIN_WPM = 150
export const MAX_WPM = 900
export const DEFAULT_WPM = 350
export const WPM_STEP = 25

const LONG_WORD = 13
const CHUNK = 8

export const clampWpm = (wpm: number) =>
  Math.min(MAX_WPM, Math.max(MIN_WPM, Math.round(wpm / WPM_STEP) * WPM_STEP))

/** Markdown to plain prose: code blocks become one token, syntax marks go. */
export const stripMarkdown = (md: string): string =>
  md
    .replace(/```[\s\S]*?(```|$)/g, '\n\n[code]\n\n')
    .replace(/<[^>\n]+>/g, ' ')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*\|?[\s:|-]+\|[\s:|-]*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/^\s{0,3}#{1,6}\s+(.*)$/gm, '\n\n$1.\n\n')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*([-*+]|\d+[.)])\s+/gm, '\n')
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, '\n\n')
    .replace(/(\*\*|__|\*|~~)(?=\S)([^\n]*?\S)\1/g, '$2')
    .replace(/[ \t]+/g, ' ')

const splitLong = (w: string): string[] => {
  if (w.length <= LONG_WORD) return [w]
  const parts: string[] = []
  for (let i = 0; i < w.length; i += CHUNK) {
    const rest = w.length - i
    // never leave a tail of one or two letters
    const take = rest <= CHUNK + 2 ? rest : CHUNK
    parts.push(w.slice(i, i + take) + (i + take < w.length ? '-' : ''))
    if (take === rest) break
  }
  return parts
}

/** How long a word stays, as a multiple of one beat. */
const pauseFor = (w: string, isParaEnd: boolean): number => {
  let mult = w.length > 8 ? 1.3 : 1
  if (isParaEnd) mult *= 3
  else if (/[.!?…]["')\]]*$/.test(w)) mult *= 2.5
  else if (/[,;:—–]["')\]]*$/.test(w)) mult *= 1.5
  return mult
}

export const tokenize = (md: string): Word[] => {
  const words: Word[] = []
  const paras = stripMarkdown(md)
    .split(/\n\s*\n/)
    .map(p => p.split(/\s+/).filter(Boolean))
    .filter(p => p.length > 0)

  for (const para of paras) {
    para.forEach((raw, i) => {
      const prev = i === 0 ? '' : (para[i - 1] ?? '')
      const isSentence = i === 0 || /[.!?…]["')\]]*$/.test(prev)
      const isParaEnd = i === para.length - 1
      const pieces = splitLong(raw)
      pieces.forEach((t, j) => {
        words.push({
          t,
          mult: j === pieces.length - 1 ? pauseFor(raw, isParaEnd) : 1,
          isSentence: isSentence && j === 0,
          isPara: i === 0 && j === 0,
        })
      })
    })
  }
  return words
}

export const delayMs = (word: Word | undefined, wpm: number) =>
  Math.round((60_000 / clampWpm(wpm)) * (word?.mult ?? 1))

/** The letter the eye fixes on: a little left of the middle. */
export const pivotIndex = (w: string): number => {
  const n = w.replace(/[^\p{L}\p{N}]/gu, '').length
  const lead = w.length - w.replace(/^[^\p{L}\p{N}]+/u, '').length
  const at = n <= 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4
  return Math.min(w.length - 1, lead + at)
}

/** The column the pivot letter always lands on. */
export const pivotColumn = (columns: number) => Math.max(2, Math.floor(columns * 0.35))

/** Splits a word so its pivot sits at `pivotColumn(columns)`. */
export const place = (w: string, columns: number) => {
  const col = pivotColumn(columns)
  const p = pivotIndex(w)
  const cut = Math.max(0, p - col)
  const left = w.slice(cut, p)
  return {
    pad: ' '.repeat(col - left.length),
    left,
    pivot: w[p] ?? '',
    right: w.slice(p + 1, p + 1 + Math.max(0, columns - col - 1)),
  }
}

export const prevSentence = (words: Word[], pos: number): number => {
  // from inside a sentence go to its start; from its start, to the one before
  let i = Math.min(pos, words.length - 1)
  if (i > 0 && words[i]?.isSentence) i -= 1
  while (i > 0 && !words[i]?.isSentence) i -= 1
  return Math.max(0, i)
}

export const nextSentence = (words: Word[], pos: number): number => {
  let i = pos + 1
  while (i < words.length && !words[i]?.isSentence) i += 1
  return Math.min(i, Math.max(0, words.length - 1))
}

export const bar = (pos: number, total: number, columns: number) => {
  const width = Math.max(4, columns)
  const filled = total <= 1 ? width : Math.round((pos / (total - 1)) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

type Message = { role: 'user' | 'assistant'; text: string; toolResults?: unknown[] }

const isPrompt = (m: Message) =>
  m.role === 'user' && !(m.toolResults && m.toolResults.length > 0) && m.text.trim() !== ''

/** Every assistant text from `from` up to the next prompt the person typed. */
const replyFrom = (messages: Message[], from: number): string => {
  const out: string[] = []
  for (let i = from; i < messages.length && !isPrompt(messages[i]!); i++) {
    const m = messages[i]!
    if (m.role === 'assistant' && m.text.trim()) out.push(m.text.trim())
  }
  return out.join('\n\n')
}

/** Claude's last reply: its texts after the last prompt the person typed. */
export const lastReply = (messages: Message[]): string => {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isPrompt(messages[i]!)) {
      const reply = replyFrom(messages, i + 1)
      if (reply) return reply
    }
  }
  return [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim())?.text ?? ''
}

/** The whole reply a drawn block of text belongs to. */
export const replyContaining = (messages: Message[], block: string): string => {
  const probe = block.trim().slice(0, 200)
  if (!probe) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.role === 'assistant' && m.text.includes(probe)) {
      let start = i
      while (start > 0 && !isPrompt(messages[start - 1]!)) start -= 1
      return replyFrom(messages, start)
    }
  }
  return block
}

const core = (t: string) =>
  t.replace(/-$/, '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '')

/** Where each word starts in the markdown it came from; -1 where it is not found. */
export const wordOffsets = (source: string, words: Word[]): number[] => {
  let cursor = 0
  return words.map(w => {
    const c = core(w.t)
    if (!c || w.t === '[code]') return -1
    const at = source.indexOf(c, cursor)
    if (at < 0) return -1
    cursor = at + c.length
    return at
  })
}

export const MARK = '⏸ '

/** Puts the stop mark before word `pos` when that word lies in `block`. */
export const markBlock = (block: string, source: string, words: Word[], pos: number): string => {
  const offsets = wordOffsets(source, words)
  // a word not found falls back to the nearest one before it
  let i = Math.min(pos, offsets.length - 1)
  while (i > 0 && (offsets[i] ?? -1) < 0) i -= 1
  const offset = offsets[i] ?? -1
  if (offset < 0) return block

  const trimmed = block.trim()
  const start = source.indexOf(trimmed)
  if (start < 0 || offset < start || offset >= start + trimmed.length) return block

  const at = block.indexOf(trimmed) + (offset - start)
  return block.slice(0, at) + MARK + block.slice(at)
}
