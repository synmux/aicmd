import { describe, expect, test } from 'vitest'
import { buildProgram, decideAction, flagsToConfig, resolveRunMode, taskFromArgs } from '../src/cli.ts'

describe('resolveRunMode', () => {
  const base = {
    execute: false,
    dryRun: false,
    configInteractive: false,
    interactiveFlag: undefined as boolean | undefined,
    hasTty: true
  }

  test('defaults to the confirm flow on a TTY', () => {
    expect(resolveRunMode(base)).toBe('confirm')
  })

  test('--dry-run always wins', () => {
    expect(resolveRunMode({ ...base, dryRun: true, execute: true })).toBe('dry-run')
    expect(resolveRunMode({ ...base, dryRun: true, configInteractive: true })).toBe('dry-run')
  })

  test('--execute runs without confirmation, TTY or not', () => {
    expect(resolveRunMode({ ...base, execute: true })).toBe('execute')
    expect(resolveRunMode({ ...base, execute: true, hasTty: false })).toBe('execute')
  })

  test('--execute beats interactive', () => {
    expect(resolveRunMode({ ...base, execute: true, configInteractive: true })).toBe('execute')
  })

  test('interactive from config or flag needs a TTY', () => {
    expect(resolveRunMode({ ...base, configInteractive: true })).toBe('interactive')
  })

  test('an explicit -i without a TTY is a hard error', () => {
    expect(
      resolveRunMode({
        ...base,
        configInteractive: true,
        interactiveFlag: true,
        hasTty: false
      })
    ).toBe('no-tty-error')
  })

  test('config-driven interactive without a TTY quietly prints', () => {
    expect(resolveRunMode({ ...base, configInteractive: true, hasTty: false })).toBe('print')
  })

  test('no TTY without --execute prints instead of confirming', () => {
    expect(resolveRunMode({ ...base, hasTty: false })).toBe('print')
  })
})

describe('flagsToConfig', () => {
  test('maps only the flags the user provided', () => {
    expect(flagsToConfig({})).toEqual({})
    expect(
      flagsToConfig({
        model: 'haiku',
        shell: '/bin/bash',
        prompt: 'prefer eza',
        interactive: true,
        count: 5,
        context: false
      })
    ).toEqual({
      model: 'haiku',
      shell: '/bin/bash',
      customPrompt: 'prefer eza',
      interactive: true,
      interactiveCount: 5,
      includeContext: false
    })
  })

  test('floors and clamps the count', () => {
    expect(flagsToConfig({ count: 0 }).interactiveCount).toBe(1)
    expect(flagsToConfig({ count: 4.9 }).interactiveCount).toBe(4)
    expect(flagsToConfig({ count: Number.NaN }).interactiveCount).toBeUndefined()
  })

  test('--no-interactive maps through as false', () => {
    expect(flagsToConfig({ interactive: false }).interactive).toBe(false)
  })
})

describe('decideAction', () => {
  const base = {
    mode: 'execute' as const,
    force: false,
    dangerous: false,
    modelSignalAvailable: true
  }

  test('execute refuses dangerous commands without force', () => {
    expect(decideAction({ ...base, dangerous: true })).toBe('refuse-dangerous')
  })

  test('execute runs dangerous commands with force', () => {
    expect(decideAction({ ...base, dangerous: true, force: true })).toBe('run')
  })

  test('execute runs safe, model-assessed commands', () => {
    expect(decideAction(base)).toBe('run')
  })

  test("execute refuses when the model's danger signal was unavailable", () => {
    // The plain-text fallback loses the model's own assessment; auto-executing
    // on the pattern list alone would silently void the -x safety promise.
    expect(decideAction({ ...base, modelSignalAvailable: false })).toBe('refuse-unassessed')
    expect(decideAction({ ...base, modelSignalAvailable: false, force: true })).toBe('run')
  })

  test('dry-run and print always print, dangerous or not', () => {
    expect(decideAction({ ...base, mode: 'dry-run', dangerous: true })).toBe('print')
    expect(decideAction({ ...base, mode: 'print', dangerous: true })).toBe('print')
  })

  test('confirm mode always confirms', () => {
    expect(decideAction({ ...base, mode: 'confirm', dangerous: true })).toBe('confirm')
  })
})

describe('buildProgram argv parsing', () => {
  function parse(argv: string[]) {
    const program = buildProgram().exitOverride()
    program.configureOutput({ writeErr: () => {}, writeOut: () => {} })
    program.parse(argv, { from: 'user' })
    return { args: program.args, opts: program.opts() }
  }

  test('flag-shaped words after the first task word stay in the task', () => {
    const { args, opts } = parse(['make', 'deploy.sh', '-x'])
    expect(args).toEqual(['make', 'deploy.sh', '-x'])
    expect(opts.execute).toBeUndefined()
  })

  test('value flags mid-task are not swallowed', () => {
    const { args, opts } = parse(['du', '-d', '1', 'in', 'this', 'folder'])
    expect(args).toEqual(['du', '-d', '1', 'in', 'this', 'folder'])
    expect(opts.dryRun).toBeUndefined()
  })

  test('unknown short flags in the task no longer error', () => {
    const { args } = parse(['list', 'files', 'with', 'ls', '-la'])
    expect(args).toEqual(['list', 'files', 'with', 'ls', '-la'])
  })

  test('leading flags still parse as options', () => {
    const { args, opts } = parse(['-x', 'convert', 'screenshot.png', 'to', 'webp'])
    expect(opts.execute).toBe(true)
    expect(args).toEqual(['convert', 'screenshot.png', 'to', 'webp'])
  })

  test('-- ends option parsing explicitly', () => {
    const { args, opts } = parse(['--', '-x', 'looking', 'task'])
    expect(args).toEqual(['-x', 'looking', 'task'])
    expect(opts.execute).toBeUndefined()
  })

  test('a non-numeric --count is a hard error, not a silent default', () => {
    expect(() => parse(['-n', 'lots', 'task'])).toThrow()
  })

  test('--count is clamped to a sane range', () => {
    expect(parse(['-n', '0', 'task']).opts.count).toBe(1)
    expect(parse(['-n', '500', 'task']).opts.count).toBe(25)
  })
})

describe('taskFromArgs', () => {
  test('joins argv words into one task string', () => {
    expect(taskFromArgs(['list', 'the', 'five', 'largest', 'files'])).toBe('list the five largest files')
  })

  test('trims and collapses to empty when nothing remains', () => {
    expect(taskFromArgs([])).toBe('')
    expect(taskFromArgs(['  ', ''])).toBe('')
  })
})
