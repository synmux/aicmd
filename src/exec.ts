/**
 * Running the approved command.
 *
 * The command executes in a child of the target shell (`shell -c command`)
 * with inherited stdio, so interactive programs, pagers and colors all work.
 * The child's exit status becomes aicmd's own. Shell state (cwd, exports)
 * cannot propagate back to the parent shell - that is a documented limit of
 * any external command runner.
 *
 * `node:child_process` is used instead of `Bun.spawn` so the same code runs
 * under Node when Bun is unavailable.
 */
import { spawn } from 'node:child_process'
import { constants as osConstants } from 'node:os'
import { AicmdError } from './errors.ts'

/** Conventional exit code for a signal death: 128 + the signal's number. */
export function signalExitCode(signal: NodeJS.Signals): number {
  const numbers = osConstants.signals as unknown as Record<string, number | undefined>
  return 128 + (numbers[signal] ?? 1)
}

/**
 * Run `command` via `shellPath -c`, inheriting stdio, and resolve with the
 * exit code (128+N for a signal death). While the child runs, the parent
 * swallows SIGINT so Ctrl-C reaches only the command - the child owns the
 * terminal until it exits.
 */
export async function executeCommand(command: string, shellPath: string): Promise<number> {
  return await new Promise<number>((resolveExit, reject) => {
    const child = spawn(shellPath, ['-c', command], { stdio: 'inherit' })

    // Take over SIGINT completely while the child owns the terminal. A no-op
    // listener disables Node's default die-on-SIGINT; detaching every other
    // listener matters just as much, or the CLI's own two-stage Ctrl-C
    // handler would force-quit the parent mid-run and orphan the child.
    // Everything is restored once the child exits.
    const priorSigintListeners = process.rawListeners('SIGINT') as Array<(...args: unknown[]) => void>
    process.removeAllListeners('SIGINT')
    const onSigint = (): void => {}
    process.on('SIGINT', onSigint)
    const cleanup = (): void => {
      process.off('SIGINT', onSigint)
      for (const listener of priorSigintListeners) {
        process.on('SIGINT', listener)
      }
    }

    child.on('error', (err) => {
      cleanup()
      reject(new AicmdError(`Could not run the shell ${shellPath}: ${err.message}`))
    })
    child.on('exit', (code, signal) => {
      cleanup()
      resolveExit(signal !== null ? signalExitCode(signal) : (code ?? 1))
    })
  })
}
