import { expect, mock, test } from 'claude-code/testing'

const REPLY = 'Rivers bend because water rarely flows straight. The outer bank erodes, the inner bank fills.'

test('the reader opens under the reply on the terminal and on the desktop', async ($, on) => {
  mock.store(on)
  mock.clock(on)

  // stands in for the engine's own drawing of the reply
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })

  on('session.messages', () => ({
    value: [
      { role: 'user' as const, text: 'Why do rivers bend?', toolUses: [] },
      { role: 'assistant' as const, text: REPLY, toolUses: [] },
    ],
  }))

  for (const surface of ['terminal', 'desktop'] as const) {
    const id = `reply-${surface}`
    const ui = await $.ui.mount({
      plugin: 'rsvp',
      surface,
      component: 'AssistantMessage',
      requestId: id,
      props: { text: REPLY, isFirstOfReply: true },
    })

    expect(await ui.find({ key: `${id}:open` })).toBeDefined()
    await ui.press({ key: `${id}:open` })

    expect(await ui.find({ key: `${id}:play` })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /1\/\d+ · \d+ wpm/ })).toBeDefined()

    await ui.press({ key: `${id}:close` })
    expect(await ui.find({ key: `${id}:play` })).toBeUndefined()
    await ui.unmount()
  }
})

test('summarize asks Sonnet about this reply only and shows the answer under it', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  on('session.messages', () => ({
    value: [
      { role: 'user' as const, text: 'Why do rivers bend?', toolUses: [] },
      { role: 'assistant' as const, text: 'An older reply.', toolUses: [] },
      { role: 'user' as const, text: 'And then?', toolUses: [] },
      { role: 'assistant' as const, text: REPLY, toolUses: [] },
    ],
  }))
  const asked: { model: string; prompt: string }[] = []
  on('model.complete', (_$, e) => {
    asked.push({ model: e.model, prompt: e.prompt })
    return { value: {
      isAnswered: true as const,
      text: 'What happened: rivers bend.\nWhat you need to do: Nothing, it\'s done.',
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    } }
  })

  const id = 'reply-sum'
  const ui = await $.ui.mount({ plugin: 'rsvp', surface: 'terminal', component: 'AssistantMessage', requestId: id, props: { text: REPLY, isFirstOfReply: true } })
  await ui.press({ key: `${id}:summarize` })

  expect(asked.length).toBe(1)
  expect(asked[0].model).toBe('sonnet')
  expect(asked[0].prompt.includes(REPLY)).toBe(true)
  expect(asked[0].prompt.includes('An older reply')).toBe(false)
  expect(await ui.find({ type: 'Text', text: /What you need to do/ })).toBeDefined()

  // the summary has a speed-read of its own, inside its box
  await ui.press({ key: `${id}:summary:open` })
  expect(await ui.find({ key: `${id}:summary:play` })).toBeDefined()
  expect(await ui.find({ key: `${id}:play` })).toBeUndefined()
  await ui.press({ key: `${id}:summary:close` })
  expect(await ui.find({ key: `${id}:summary:play` })).toBeUndefined()

  await ui.press({ key: `${id}:summary-hide` })
  expect(await ui.find({ type: 'Text', text: /What you need to do/ })).toBeUndefined()
  expect(await ui.find({ key: `${id}:summarize` })).toBeDefined()
  await ui.unmount()
})
