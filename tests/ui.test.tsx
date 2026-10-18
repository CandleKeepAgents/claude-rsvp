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
