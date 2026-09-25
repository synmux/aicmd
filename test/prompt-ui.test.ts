import { describe, expect, test } from 'vitest'
import { confirmRun, parseConfirmAnswer, renderConfirmFrame, resolveEditor } from '../src/ui/prompt.ts'
import { fakeTerminal, KEY, press } from './terminal.ts'

describe('parseConfirmAnswer', () => {
  test('defaults to no on an empty answer', () => {
    expect(parseConfirmAnswer('')).toBe('no')
    expect(parseConfirmAnswer('   ')).toBe('no')
  })

  test('maps the documented answers', () => {
    expect(parseConfirmAnswer('y')).toBe('yes')
    expect(parseConfirmAnswer('YES')).toBe('yes')
    expect(parseConfirmAnswer('n')).toBe('no')
    expect(parseConfirmAnswer('no')).toBe('no')
    expect(parseConfirmAnswer('e')).toBe('edit')
    expect(parseConfirmAnswer('edit')).toBe('edit')
  })

  test('anything else is unrecognised', () => {
    expect(parseConfirmAnswer('maybe')).toBeNull()
  })
})

describe('resolveEditor', () => {
  test("follows git's lookup order", () => {
    expect(resolveEditor({ GIT_EDITOR: 'ge', VISUAL: 'vi', EDITOR: 'ed' })).toBe('ge')
    expect(resolveEditor({ VISUAL: 'code --wait', EDITOR: 'ed' })).toBe('code --wait')
    expect(resolveEditor({ EDITOR: 'nano' })).toBe('nano')
    expect(resolveEditor({})).toBe('vi')
  })
})

describe('renderConfirmFrame', () => {
  test('asks the question and lists the keys with No as the default', () => {
    const frame = renderConfirmFrame({ state: 'active' })
    expect(frame).toContain('Run this command?')
    expect(frame).toContain('y')
    expect(frame).toContain('n')
    expect(frame).toContain('e')
    expect(frame.toLowerCase()).toContain('enter')
  })

  test('shows the chosen answer once settled', () => {
    expect(renderConfirmFrame({ state: 'submit', choice: 'yes' })).toContain('Yes')
    expect(renderConfirmFrame({ state: 'submit', choice: 'edit' })).toContain('Edit')
    expect(renderConfirmFrame({ state: 'cancel', choice: 'no' })).toContain('No')
  })
})

describe('confirmRun', () => {
  async function answerWith(...keys: string[]) {
    const terminal = fakeTerminal()
    const pending = confirmRun({ input: terminal.input, output: terminal.output })
    await press(terminal.input, ...keys)
    return { choice: await pending, terminal }
  }

  test('Enter alone means No', async () => {
    const { choice } = await answerWith(KEY.enter)
    expect(choice).toBe('no')
  })

  test('y and Y mean yes', async () => {
    expect((await answerWith('y')).choice).toBe('yes')
    expect((await answerWith('Y')).choice).toBe('yes')
  })

  test('n means no and e means edit', async () => {
    expect((await answerWith('n')).choice).toBe('no')
    expect((await answerWith('e')).choice).toBe('edit')
  })

  test('Ctrl-C and Escape both mean No', async () => {
    expect((await answerWith(KEY.ctrlC)).choice).toBe('no')
    expect((await answerWith(KEY.escape)).choice).toBe('no')
  })

  test('unrelated keys are ignored until a real answer arrives', async () => {
    const { choice, terminal } = await answerWith('x', '7', KEY.down, 'y')
    expect(choice).toBe('yes')
    expect(terminal.text()).toContain('Run this command?')
  })
})
