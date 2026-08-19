/**
 * Terminal input helpers: asking for the task when argv is empty, reading a
 * piped task from stdin, the run confirmation prompt, and `$EDITOR`
 * integration for tweaking a command before it runs.
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { AicmdError } from '../errors.ts'

/** Resolve the editor command, mirroring git's lookup order. */
export function resolveEditor(env: Record<string, string | undefined> = process.env): string {
  return env.GIT_EDITOR || env.VISUAL || env.EDITOR || 'vi'
}

type ReadlineInterface = ReturnType<typeof createInterface>

/**
 * Ask one question, resolving `null` when the user bails out: EOF (Ctrl-D
 * closes the interface) or Ctrl-C (readline swallows the process SIGINT and
 * emits its own event, so without this the promise would simply never
 * settle and the CLI would hang).
 */
export function askLine(rl: ReadlineInterface, promptText: string): Promise<string | null> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (value: string | null): void => {
      if (settled) return
      settled = true
      rl.off('close', onClose)
      rl.off('SIGINT', onSigint)
      resolve(value)
    }
    const onClose = (): void => finish(null)
    const onSigint = (): void => {
      process.stderr.write('\n')
      finish(null)
    }
    rl.once('close', onClose)
    rl.once('SIGINT', onSigint)
    rl.question(promptText, (answer) => finish(answer))
  })
}

/** Ask for the task interactively (stderr prompt, requires a TTY on stdin). */
export async function askTask(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    const answer = await askLine(rl, 'What should the command do? ')
    return (answer ?? '').trim()
  } finally {
    rl.close()
  }
}

/** Read the whole of stdin as the task (for `echo task | aicmd`). */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk as Buffer))
  }
  return Buffer.concat(chunks).toString('utf8').trim()
}

export type ConfirmChoice = 'yes' | 'no' | 'edit'

/**
 * Map one typed answer to a confirm choice, or `null` when unrecognised.
 * The default (empty answer) is **No**: running a generated shell command
 * should take a deliberate keypress.
 */
export function parseConfirmAnswer(answer: string): ConfirmChoice | null {
  const normalised = answer.trim().toLowerCase()
  if (normalised === 'y' || normalised === 'yes') return 'yes'
  if (normalised === '' || normalised === 'n' || normalised === 'no') {
    return 'no'
  }
  if (normalised === 'e' || normalised === 'edit') return 'edit'
  return null
}

/** Prompt for [y]es / [N]o / [e]dit on stderr. EOF and Ctrl-C mean No. */
export async function confirmRun(): Promise<ConfirmChoice> {
  const rl = createInterface({ input: process.stdin, output: process.stderr })
  try {
    for (;;) {
      const answer = await askLine(rl, 'Run this command? [y/N/e] ')
      if (answer === null) return 'no'
      const choice = parseConfirmAnswer(answer)
      if (choice !== null) return choice
      process.stderr.write('Please answer y, n, or e.\n')
    }
  } finally {
    rl.close()
  }
}

/** Open `initial` in the user's editor and return the saved contents. */
export async function editInEditor(initial: string): Promise<string> {
  const editor = resolveEditor()
  // Unpredictable name + exclusive create (`wx`) + owner-only perms (0o600)
  // so the temp file can't be pre-created as a symlink or read by other users.
  const file = join(tmpdir(), `aicmd-edit-${randomUUID()}.txt`)
  try {
    await writeFile(file, initial, { mode: 0o600, flag: 'wx' })
  } catch (err) {
    throw new AicmdError(`Could not create a temporary file to edit the command: ${(err as Error).message}`)
  }
  try {
    await runEditor(editor, file)
    const edited = await readFile(file, 'utf8')
    // Drop trailing whitespace/newline noise editors tend to add.
    return edited.replace(/\s+$/, '')
  } catch (err) {
    if (err instanceof AicmdError) throw err
    throw new AicmdError(`Editing the command failed (${editor}): ${(err as Error).message}`)
  } finally {
    await unlink(file).catch(() => {})
  }
}

function runEditor(editor: string, file: string): Promise<void> {
  return new Promise((resolveEdit, reject) => {
    // $EDITOR / $GIT_EDITOR are shell command lines that may contain flags,
    // spaces in the program path, or quoted arguments (e.g. "code --wait" or
    // "/path/with spaces/editor"). Run them through the shell exactly as git
    // does rather than naively splitting on whitespace. The file path is our
    // own (tmpdir + UUID), so double-quoting it is safe.
    const child = spawn(`${editor} "${file}"`, {
      stdio: 'inherit',
      shell: true
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0 || code === null) resolveEdit()
      else reject(new Error(`Editor exited with code ${code}`))
    })
  })
}
