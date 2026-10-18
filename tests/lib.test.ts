import { expect, test } from 'claude-code/testing'

import { delayMs, lastReply, nextSentence, pivotIndex, place, prevSentence, replyContaining, stripMarkdown, tokenize } from '../hooks/lib'

test('markdown marks go, code becomes one token', () => {
  const text = stripMarkdown('## Title\n\nSome **bold** and `code` with a [link](https://x.y).\n\n```ts\nconst a = 1\n```\n- item one')
  expect(text).not.toContain('**')
  expect(text).not.toContain('`')
  expect(text).not.toContain('https')
  expect(text).not.toContain('const a')
  expect(text).toContain('[code]')
  expect(text).toContain('link')
})

test('sentence ends and paragraphs pause longer than plain words', () => {
  const words = tokenize('One two, three.\n\nFour')
  const by = (t: string) => words.find(w => w.t === t)!
  expect(delayMs(by('One'), 300)).toBe(200)
  expect(delayMs(by('two,'), 300)).toBe(300)
  expect(delayMs(by('three.'), 300)).toBe(600)
  expect(by('Four').isPara).toBe(true)
  expect(by('Four').isSentence).toBe(true)
})

test('long words are split without a tiny tail', () => {
  const words = tokenize('internationalization')
  expect(words.length).toBeGreaterThan(1)
  expect(words.every(w => w.t.replace('-', '').length >= 3)).toBe(true)
  expect(words.map(w => w.t.replace(/-$/, '')).join('')).toBe('internationalization')
})

test('the pivot letter always lands on the same column', () => {
  for (const w of ['a', 'word', 'reading', '"quoted"']) {
    const p = place(w, 30)
    expect(p.pad.length + p.left.length).toBe(10)
    expect(p.pivot).toBe(w[pivotIndex(w)])
  }
})

test('sentence jumps go to sentence starts', () => {
  const words = tokenize('A b c. D e f. G h.')
  expect(words[nextSentence(words, 0)]!.t).toBe('D')
  expect(words[nextSentence(words, 3)]!.t).toBe('G')
  expect(words[prevSentence(words, 4)]!.t).toBe('D')
  expect(words[prevSentence(words, 3)]!.t).toBe('A')
})

test('the last reply joins every text after the last typed prompt', () => {
  const messages = [
    { role: 'user' as const, text: 'old question' },
    { role: 'assistant' as const, text: 'old answer' },
    { role: 'user' as const, text: 'new question' },
    { role: 'assistant' as const, text: 'Checking.' },
    { role: 'user' as const, text: '', toolResults: [{}] },
    { role: 'assistant' as const, text: 'Here is the answer.' },
  ]
  expect(lastReply(messages)).toBe('Checking.\n\nHere is the answer.')
  expect(replyContaining(messages, 'old answer')).toBe('old answer')
  expect(replyContaining(messages, 'Checking.')).toBe('Checking.\n\nHere is the answer.')
})
