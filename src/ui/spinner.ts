/**
 * The progress spinner shown while the model generates.
 *
 * It is deliberately hand-rolled rather than Clack's `spinner()`: that one
 * puts stdin into raw mode and calls `process.exit(0)` on Ctrl-C, which would
 * bypass aicmd's two-stage SIGINT handling (first Ctrl-C aborts the SDK
 * subprocess gracefully, a second force-quits with 130) and report success
 * on a cancelled run. This spinner only writes frames; Ctrl-C keeps
 * generating a real SIGINT.
 *
 * It renders in Clack's guide-bar style so it sits naturally above the
 * command block, writes to stderr (stdout stays clean for piping) and only
 * animates when explicitly enabled: callers gate on `process.stderr.isTTY`
 * and `--no-spinner`. When disabled, `start`/`update` are silent no-ops but
 * final status lines (`succeed`/`fail`) still print.
 *
 * While animating on a real terminal, keypresses on stdin are discarded so
 * that characters typed during generation cannot pre-answer the confirmation
 * prompt that follows; Ctrl-C typed in that raw-mode window is turned back
 * into a SIGINT so cancellation keeps working.
 *
 * The animation is chosen by the `spinner` config key: any name from
 * cli-spinners, defaulting to {@link DEFAULT_SPINNER}.
 */
import type { Writable } from 'node:stream'
import { styleText } from 'node:util'
import { log, S_BAR } from '@clack/prompts'
import spinners, { type Spinner as SpinnerAnimation } from 'cli-spinners'
import { CHROME_STREAM } from './chrome.ts'

/** The spinner used when none (or an unknown one) is configured. */
export const DEFAULT_SPINNER = 'material'

/** Whether `name` is one of the cli-spinners animations. */
export function isSpinnerName(name: string): boolean {
  return Object.hasOwn(spinners, name)
}

/**
 * Look up a spinner animation by name, falling back to {@link DEFAULT_SPINNER}
 * for unknown names (a cosmetic option must never be able to break a run).
 */
export function resolveSpinner(name: string): SpinnerAnimation {
  const known = (spinners as Record<string, SpinnerAnimation | undefined>)[name]
  return known ?? spinners[DEFAULT_SPINNER]
}

interface RawInput extends NodeJS.ReadStream {
  setRawMode(mode: boolean): this
}

const ERASE_LINE = '\x1b[2K'
const CURSOR_START = '\x1b[G'
const CURSOR_HIDE = '\x1b[?25l'
const CURSOR_SHOW = '\x1b[?25h'

export interface SpinnerStreams {
  output?: Writable
  input?: NodeJS.ReadStream
}

export class Spinner {
  private readonly enabled: boolean
  private readonly animation: SpinnerAnimation
  private readonly output: Writable
  private readonly input: NodeJS.ReadStream
  private timer: NodeJS.Timeout | null = null
  private frameIndex = 0
  private label = ''
  private restoreInput: (() => void) | null = null

  constructor(enabled = process.stderr.isTTY, spinnerName = DEFAULT_SPINNER, streams: SpinnerStreams = {}) {
    this.enabled = Boolean(enabled)
    this.animation = resolveSpinner(spinnerName)
    this.output = streams.output ?? CHROME_STREAM
    this.input = streams.input ?? process.stdin
  }

  start(label: string): void {
    if (!this.enabled) return
    this.stop()
    this.label = label
    this.frameIndex = 0
    this.output.write(`${styleText('gray', S_BAR)}\n${CURSOR_HIDE}`)
    this.discardInput()
    this.drawFrame()
    this.timer = setInterval(() => this.drawFrame(), this.animation.interval)
  }

  update(label: string): void {
    this.label = label
  }

  /** Stop and clear the spinner line, optionally printing a final status line. */
  stop(finalLine?: string): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
      this.output.write(`${CURSOR_START}${ERASE_LINE}${CURSOR_SHOW}`)
    }
    this.restoreInput?.()
    this.restoreInput = null
    if (finalLine !== undefined) log.message(finalLine, { output: this.output, spacing: 0 })
  }

  succeed(label: string): void {
    this.stop(`${styleText('green', '✔')} ${label}`)
  }

  fail(label: string): void {
    this.stop(`${styleText('red', '✖')} ${label}`)
  }

  private drawFrame(): void {
    const frame = this.animation.frames[this.frameIndex] ?? ''
    this.frameIndex = (this.frameIndex + 1) % this.animation.frames.length
    this.output.write(`${CURSOR_START}${ERASE_LINE}${styleText('magenta', frame)}  ${this.label}`)
  }

  /**
   * Swallow keypresses while spinning (real TTYs only). Raw mode stops the
   * terminal from generating SIGINT itself, so Ctrl-C is re-raised by hand.
   */
  private discardInput(): void {
    const input = this.input as RawInput
    if (!input.isTTY || typeof input.setRawMode !== 'function') return
    const onData = (chunk: Buffer | string): void => {
      if (String(chunk).includes('\x03')) process.kill(process.pid, 'SIGINT')
    }
    input.setRawMode(true)
    input.on('data', onData)
    input.resume()
    this.restoreInput = () => {
      input.off('data', onData)
      input.setRawMode(false)
      input.pause()
    }
  }
}
