/**
 * A fake terminal for driving Clack prompts and the spinner in tests.
 *
 * Clack reads keypresses from any Readable (it only enables raw mode on real
 * TTYs) and renders to any Writable, so a PassThrough for input plus a
 * collecting Writable for output is enough to exercise the real prompt code -
 * key handling, cursor movement, submit and cancel - without a terminal.
 */
import { PassThrough, Writable } from 'node:stream'
import { setTimeout as sleep } from 'node:timers/promises'
import { stripVTControlCharacters } from 'node:util'

/** Raw key sequences as a terminal would deliver them. */
export const KEY = {
  up: '\x1b[A',
  down: '\x1b[B',
  enter: '\r',
  escape: '\x1b',
  ctrlC: '\x03',
  ctrlD: '\x04'
} as const

export interface FakeTerminal {
  input: PassThrough
  output: Writable & { columns: number; rows: number }
  /** Everything written so far, ANSI escape sequences stripped. */
  text(): string
  /** Everything written so far, verbatim. */
  raw(): string
}

export function stripAnsi(text: string): string {
  return stripVTControlCharacters(text)
}

export function fakeTerminal(size: { columns?: number; rows?: number } = {}): FakeTerminal {
  const chunks: string[] = []
  const output = Object.assign(
    new Writable({
      write(chunk, _encoding, next) {
        chunks.push(String(chunk))
        next()
      }
    }),
    { columns: size.columns ?? 80, rows: size.rows ?? 24 }
  )
  return {
    input: new PassThrough(),
    output,
    text: () => stripAnsi(chunks.join('')),
    raw: () => chunks.join('')
  }
}

/**
 * Deliver key sequences one at a time with a short gap, so readline's escape
 * sequence timeout (50ms in Clack) can settle a lone Escape before the next
 * key arrives and each keypress is processed as its own event.
 */
export async function press(input: PassThrough, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    input.write(key)
    await sleep(key === KEY.escape ? 80 : 10)
  }
}
