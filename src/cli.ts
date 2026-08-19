/**
 * Command-line interface: argument parsing (Commander) and orchestration of
 * the dry-run, execute, confirm and interactive flows.
 */
import { Command, InvalidArgumentError } from 'commander'
import { presentCredentialVars } from './agent.ts'
import { loadFileConfig, resolveConfig } from './config.ts'
import { gatherContext, resolveShell } from './context.ts'
import { AicmdError } from './errors.ts'
import { executeCommand } from './exec.ts'
import { generateCommands } from './generate.ts'
import { assessDanger, effectivePatterns } from './safety.ts'
import type { Config, DangerAssessment, PartialConfig } from './types.ts'
import { color } from './ui/colors.ts'
import { askTask, confirmRun, editInEditor, readStdin } from './ui/prompt.ts'
import { Spinner } from './ui/spinner.ts'
import { getVersion } from './utils.ts'

export const VERSION = getVersion()

export interface CliOptions {
  execute?: boolean
  force?: boolean
  dryRun?: boolean
  interactive?: boolean
  count?: number
  model?: string
  shell?: string
  prompt?: string
  context?: boolean
  spinner?: boolean
  config?: string
  verbose?: boolean
}

/** Upper bound for -n/--count; more candidates than this helps nobody. */
const MAX_INTERACTIVE_COUNT = 25

function parseCount(value: string): number {
  const parsed = parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    throw new InvalidArgumentError('count must be a number')
  }
  return Math.min(MAX_INTERACTIVE_COUNT, Math.max(1, parsed))
}

export function buildProgram(): Command {
  const program = new Command()
  program
    .name('aicmd')
    .description('Generate a shell command from a natural-language task with Claude, ' + 'confirm it, and run it.')
    .version(VERSION, '-V, --version', 'output the version number')
    // Options are recognised only before the first task word: the task is
    // natural language and words like "-x" or "ls -la" inside it must never
    // flip run modes ("quoting optional" is a documented promise).
    .enablePositionalOptions()
    .passThroughOptions()
    .argument('[task...]', 'what the command should do (or pipe it on stdin)')
    .option('-x, --execute', 'run the command without a confirmation prompt (dangerous commands are still refused)')
    .option('-f, --force', 'with --execute: run even when the command is flagged dangerous')
    .option('-d, --dry-run', 'print the command to stdout and exit')
    .option('-i, --interactive', 'pick between several candidate commands in an interactive TUI')
    .option('--no-interactive', 'skip the interactive TUI even when "interactive" is set in config')
    .option('-n, --count <n>', 'number of candidates to generate in interactive mode', parseCount)
    .option('-m, --model <model>', 'model to use (alias or full model id)')
    .option('-s, --shell <shell>', 'shell to generate for and execute with (default: $SHELL)')
    .option('-p, --prompt <text>', 'extra instructions appended to the prompt')
    .option('--no-context', 'omit the platform/shell context block from the prompt')
    .option('--no-spinner', 'disable the progress spinner')
    .option('--config <path>', 'path to a config file')
    .option('-v, --verbose', 'print cost, model and debug output on stderr')
    .addHelpText(
      'after',
      [
        '',
        'Authentication:',
        '  Uses the Claude Agent SDK with your Claude Code subscription (run',
        '  `claude login`). ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are ignored',
        '  unless the config sets "allowApiKey": true (pay-as-you-go billing).',
        '',
        'Examples:',
        '  aicmd list the five largest files here',
        '  aicmd -x convert screenshot.png to webp',
        '  aicmd -i find every TODO in tracked files',
        '  aicmd -d "tar this directory" | pbcopy',
        "  echo 'kill whatever listens on :3000' | aicmd -x",
        '  aicmd -- -x is part of this task   # -- ends option parsing',
        '',
        'Options are read only before the first task word, so flag-shaped',
        'words inside the task ("ls -la", "up -d") are left alone.'
      ].join('\n')
    )
  return program
}

/** Map parsed CLI flags onto a partial config (only set keys the user provided). */
export function flagsToConfig(opts: CliOptions): PartialConfig {
  const cfg: PartialConfig = {}
  if (opts.model !== undefined) cfg.model = opts.model
  if (opts.shell !== undefined) cfg.shell = opts.shell
  if (opts.prompt !== undefined) cfg.customPrompt = opts.prompt
  if (opts.interactive !== undefined) cfg.interactive = opts.interactive
  if (opts.context !== undefined) cfg.includeContext = opts.context
  if (opts.count !== undefined && Number.isFinite(opts.count)) {
    cfg.interactiveCount = Math.max(1, Math.floor(opts.count))
  }
  return cfg
}

/** The task string from positional argv words. */
export function taskFromArgs(words: string[]): string {
  return words.join(' ').trim()
}

export type RunMode = 'dry-run' | 'execute' | 'interactive' | 'confirm' | 'print' | 'no-tty-error'

/**
 * Decide which flow to run.
 *
 * - `--dry-run` always wins: it prints and never executes.
 * - `--execute` runs without prompting, TTY or not (safety still refuses
 *   dangerous commands unless `--force`).
 * - Interactive requires a TTY. An explicit `-i` without one is a hard error
 *   (the user asked for something we cannot provide), whereas interactive
 *   coming only from config quietly degrades.
 * - Without a TTY there is no way to confirm, and executing unconfirmed was
 *   not requested - so the command is printed to stdout instead ("print"),
 *   which makes `aicmd "..." | sh` compose.
 */
export function resolveRunMode(args: {
  execute: boolean
  dryRun: boolean
  configInteractive: boolean
  interactiveFlag: boolean | undefined
  hasTty: boolean
}): RunMode {
  if (args.dryRun) return 'dry-run'
  if (args.execute) return 'execute'
  if (args.configInteractive) {
    if (args.hasTty) return 'interactive'
    return args.interactiveFlag === true ? 'no-tty-error' : 'print'
  }
  return args.hasTty ? 'confirm' : 'print'
}

/** What to do with the generated command once its danger verdict is known. */
export type PlainAction = 'refuse-dangerous' | 'refuse-unassessed' | 'run' | 'print' | 'confirm'

/**
 * The safety-routing decision for the non-interactive flows, extracted as a
 * pure function so the matrix is testable: `--execute` refuses dangerous
 * commands without `--force`, and also refuses when the model's own danger
 * self-assessment was unavailable (the plain-text fallback) - a defaulted
 * "not dangerous" must never auto-execute on the pattern list alone.
 */
export function decideAction(args: {
  mode: RunMode
  force: boolean
  dangerous: boolean
  modelSignalAvailable: boolean
}): PlainAction {
  switch (args.mode) {
    case 'dry-run':
    case 'print':
      return 'print'
    case 'confirm':
      return 'confirm'
    case 'execute':
      if (args.dangerous) return args.force ? 'run' : 'refuse-dangerous'
      if (!args.modelSignalAvailable && !args.force) return 'refuse-unassessed'
      return 'run'
    default:
      throw new AicmdError(`Unhandled run mode: ${args.mode}`)
  }
}

/** Print the command inside a dim rule block on stderr. */
export function printCommandBlock(command: string): void {
  const bar = color('90', '─'.repeat(48))
  process.stderr.write(`\n${bar}\n${command}\n${bar}\n`)
}

/** Print the danger warning with its reasons on stderr. */
export function printDangerWarning(danger: DangerAssessment): void {
  process.stderr.write(`${color('33', '⚠  This command looks potentially destructive:')}\n`)
  for (const reason of danger.reasons) {
    process.stderr.write(`${color('33', `   • ${reason}`)}\n`)
  }
}

interface FlowOptions {
  mode: RunMode
  force: boolean
  verbose: boolean
  spinnerEnabled: boolean
  abortController: AbortController
}

/** Entry point. Returns a process exit code. */
export async function run(argv: string[]): Promise<number> {
  const program = buildProgram()
  program.parse(argv, { from: 'user' })
  const opts = program.opts<CliOptions>()
  // A lone `--no-context` option defaults to `true` when not passed; only a
  // real CLI occurrence may override the config file layer.
  if (program.getOptionValueSource('context') !== 'cli') delete opts.context
  const verbose = Boolean(opts.verbose)

  const abortController = new AbortController()
  // Two-stage Ctrl-C: the first interrupt asks the in-flight generation to
  // cancel gracefully (aborting the SDK subprocess); a second, impatient
  // interrupt force-quits in case that abort is slow to take effect.
  let interrupting = false
  const onSigint = (): void => {
    if (interrupting) {
      // Second Ctrl-C: force-quit. Restore the cursor in case a spinner hid
      // it, since this path bypasses the spinner's own cleanup.
      if (process.stderr.isTTY) process.stderr.write('\x1b[?25h')
      process.exit(130)
    }
    interrupting = true
    abortController.abort()
  }
  process.on('SIGINT', onSigint)

  try {
    const fileConfig = await loadFileConfig(process.cwd(), {
      ...(opts.config !== undefined ? { configPath: opts.config } : {})
    })
    const config = resolveConfig(fileConfig, flagsToConfig(opts))

    // Surface the credential gate: the actual stripping happens in the agent
    // layer, but silently ignoring an exported key would be confusing.
    if (!config.allowApiKey) {
      const ignored = presentCredentialVars(process.env)
      if (ignored.length > 0) {
        process.stderr.write(
          `${color(
            '90',
            `Ignoring ${ignored.join(' and ')}: using subscription auth. Set ` +
              `"allowApiKey": true in your aicmd config to use API credentials.`
          )}\n`
        )
      }
    }

    let task = taskFromArgs(program.args)
    if (task === '') {
      task = process.stdin.isTTY ? await askTask() : await readStdin()
    }
    if (task === '') {
      throw new AicmdError('No task given. Pass it as arguments, pipe it on stdin, or type it at the prompt.')
    }

    const mode = resolveRunMode({
      execute: Boolean(opts.execute),
      dryRun: Boolean(opts.dryRun),
      configInteractive: config.interactive,
      interactiveFlag: opts.interactive,
      hasTty: Boolean(process.stdin.isTTY && process.stdout.isTTY)
    })
    if (mode === 'no-tty-error') {
      throw new AicmdError('Interactive mode (-i) requires an interactive terminal.')
    }

    const flow: FlowOptions = {
      mode,
      force: Boolean(opts.force),
      verbose,
      spinnerEnabled: opts.spinner !== false,
      abortController
    }

    if (mode === 'interactive') {
      const { runInteractive } = await import('./ui/interactive.ts')
      return await runInteractive(task, config, flow)
    }
    return await runPlain(task, config, flow)
  } catch (err) {
    if (err instanceof AicmdError) {
      process.stderr.write(`${color('31', 'error:')} ${err.message}\n`)
      return 1
    }
    throw err
  } finally {
    process.off('SIGINT', onSigint)
  }
}

/** Generate one command and route it through the non-interactive modes. */
async function runPlain(task: string, config: Config, flow: FlowOptions): Promise<number> {
  const shellPath = resolveShell(config.shell)
  const spinner = new Spinner(flow.spinnerEnabled && process.stderr.isTTY, config.spinner)

  spinner.start('Generating command')
  let result: Awaited<ReturnType<typeof generateCommands>>
  try {
    result = await generateCommands(task, config, {
      contextBlock: gatherContext(config),
      shellPath,
      progress: { onPhase: (label) => spinner.update(label) },
      abortController: flow.abortController,
      ...(flow.verbose ? { onStderr: (data: string) => process.stderr.write(data) } : {})
    })
  } catch (err) {
    spinner.stop() // always restore the cursor / clear the line on failure
    throw err
  }
  spinner.stop()

  if (flow.verbose) {
    process.stderr.write(
      `${color('90', `cost $${result.costUsd.toFixed(4)}${result.model ? ` (${result.model})` : ''}`)}\n`
    )
  }

  const candidate = result.candidates[0]
  if (candidate === undefined) {
    throw new AicmdError('The model did not produce a command.')
  }
  const patterns = effectivePatterns(config)
  const danger = assessDanger(candidate, patterns)
  const action = decideAction({
    mode: flow.mode,
    force: flow.force,
    dangerous: danger.dangerous,
    modelSignalAvailable: danger.modelSignalAvailable
  })

  switch (action) {
    case 'print': {
      // Only the command goes to stdout so the output can be piped; all
      // chrome (warnings, notes, the explanation) stays on stderr.
      if (danger.dangerous) printDangerWarning(danger)
      printDegradedSignalNote(danger)
      if (flow.mode === 'print') {
        process.stderr.write(`${color('90', 'No interactive terminal: printing instead of running.')}\n`)
      }
      if (config.showExplanation && candidate.explanation !== '') {
        process.stderr.write(`${color('90', candidate.explanation)}\n`)
      }
      process.stdout.write(`${candidate.command}\n`)
      return 0
    }
    case 'refuse-dangerous': {
      process.stderr.write(`${color('31', '✖ SAFETY:')} refusing to auto-execute a potentially destructive command.\n`)
      printDangerWarning(danger)
      printCommandBlock(candidate.command)
      process.stderr.write(
        'Re-run with --force (-f) to execute anyway, or without --execute ' + '(-x) for a confirmation prompt.\n'
      )
      return 1
    }
    case 'refuse-unassessed': {
      process.stderr.write(
        color('31', '✖ SAFETY:') +
          " refusing to auto-execute: the model's danger self-assessment was " +
          'unavailable (plain-text fallback), so only the local guard ' +
          'patterns were checked.\n'
      )
      printCommandBlock(candidate.command)
      process.stderr.write(
        'Re-run with --force (-f) to execute anyway, or without --execute ' + '(-x) for a confirmation prompt.\n'
      )
      return 1
    }
    case 'run': {
      if (danger.dangerous) {
        process.stderr.write(`${color('33', '⚠  FORCE MODE: executing despite the danger flags.')}\n`)
        printDangerWarning(danger)
      }
      printDegradedSignalNote(danger)
      if (config.showExplanation && candidate.explanation !== '') {
        process.stderr.write(`${color('90', candidate.explanation)}\n`)
      }
      return await runCommand(candidate.command, shellPath)
    }
    case 'confirm': {
      printCommandBlock(candidate.command)
      if (config.showExplanation && candidate.explanation !== '') {
        process.stderr.write(`${color('90', candidate.explanation)}\n`)
      }
      if (danger.dangerous) {
        process.stderr.write('\n')
        printDangerWarning(danger)
      }
      printDegradedSignalNote(danger)
      process.stderr.write('\n')

      const choice = await confirmRun()
      if (choice === 'no') {
        process.stderr.write('Cancelled. Nothing was executed.\n')
        return 1
      }
      let command = candidate.command
      if (choice === 'edit') {
        command = (await editInEditor(command)).trim()
        if (command === '') {
          process.stderr.write('Cancelled: empty command.\n')
          return 1
        }
        // The user wrote the edited command themselves, so it runs without
        // another prompt - but the guard patterns still get to warn.
        const editedDanger = assessDanger({ command, explanation: '', dangerous: false }, patterns)
        if (editedDanger.dangerous) printDangerWarning(editedDanger)
      }
      return await runCommand(command, shellPath)
    }
    default:
      throw new AicmdError(`Unhandled action: ${action}`)
  }
}

/**
 * One dim stderr line whenever a verdict lacked the model's own assessment,
 * so a silently degraded environment (structured output unavailable) is
 * always visible - not just under `-v`.
 */
function printDegradedSignalNote(danger: DangerAssessment): void {
  if (danger.modelSignalAvailable) return
  process.stderr.write(
    `${color(
      '90',
      "Note: the model's danger self-assessment was unavailable " +
        '(plain-text fallback); only local guard patterns were applied.'
    )}\n`
  )
}

/** Announce and execute the final command, returning its exit code. */
export async function runCommand(command: string, shellPath: string): Promise<number> {
  process.stderr.write(`${color('36', '▶')} ${command}\n`)
  return await executeCommand(command, shellPath)
}
