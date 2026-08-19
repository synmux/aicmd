import { describe, expect, test } from 'bun:test'
import type { runPrompt } from '../src/agent.ts'
import { DEFAULT_CONFIG } from '../src/config.ts'
import { AicmdError } from '../src/errors.ts'
import { generateCommands } from '../src/generate.ts'
import { COMMANDS_SCHEMA, OPTION_DELIMITER } from '../src/prompts.ts'
import type { ModelResult } from '../src/types.ts'
import { itemAt } from './helpers.ts'

type Runner = typeof runPrompt
type RunnerCall = { prompt: string; opts: Parameters<Runner>[1] }

/** A runner that replays scripted results/errors and records every call. */
function scriptedRunner(script: Array<ModelResult | Error>): {
  runner: Runner
  calls: RunnerCall[]
} {
  const calls: RunnerCall[] = []
  const runner: Runner = async (prompt, opts) => {
    calls.push({ prompt, opts })
    const next = script.shift()
    if (next === undefined) throw new Error('scripted runner exhausted')
    if (next instanceof Error) throw next
    return next
  }
  return { runner, calls }
}

const structuredResult = (commands: Array<Record<string, unknown>>, costUsd = 0.01): ModelResult => ({
  text: '',
  costUsd,
  model: 'claude-sonnet-5',
  structured: { commands }
})

const candidate = {
  command: 'ls -la',
  explanation: 'lists files',
  dangerous: false
}

describe('generateCommands', () => {
  const config = { ...DEFAULT_CONFIG }

  test('returns candidates from a structured response', async () => {
    const { runner, calls } = scriptedRunner([structuredResult([candidate])])
    const result = await generateCommands('list files', config, {
      runner,
      contextBlock: 'Platform: test.',
      shellPath: '/bin/zsh'
    })
    expect(result.candidates).toHaveLength(1)
    expect(itemAt(result.candidates, 0).command).toBe('ls -la')
    expect(result.costUsd).toBe(0.01)
    expect(result.model).toBe('claude-sonnet-5')

    expect(calls).toHaveLength(1)
    expect(itemAt(calls, 0).opts.outputFormat).toEqual({
      type: 'json_schema',
      schema: COMMANDS_SCHEMA
    })
    expect(itemAt(calls, 0).opts.system).toContain('Platform: test.')
    expect(itemAt(calls, 0).prompt).toContain('list files')
  })

  test('falls back to plain text when structured attempts fail', async () => {
    const { runner, calls } = scriptedRunner([
      new Error('structured output unsupported'),
      { text: '```sh\nls -la\n```', costUsd: 0.02 }
    ])
    const result = await generateCommands('list files', config, {
      runner,
      shellPath: '/bin/sh'
    })
    expect(itemAt(result.candidates, 0).command).toBe('ls -la')
    // Fallback candidates carry no model danger assessment; downstream safety
    // routing must be able to see that.
    expect(itemAt(result.candidates, 0).modelAssessed).toBe(false)
    expect(calls).toHaveLength(2)
    expect(itemAt(calls, 0).opts.outputFormat).toBeDefined()
    expect(itemAt(calls, 1).opts.outputFormat).toBeUndefined()
  })

  test('passes a verbose stderr sink through to the runner', async () => {
    const { runner, calls } = scriptedRunner([structuredResult([candidate])])
    const sink = (_data: string) => {}
    await generateCommands('list', config, {
      runner,
      shellPath: '/bin/sh',
      onStderr: sink
    })
    expect(itemAt(calls, 0).opts.onStderr).toBe(sink)
  })

  test('a malformed structured payload falls through to the next attempt', async () => {
    const { runner, calls } = scriptedRunner([
      { text: '', costUsd: 0.01, structured: { nonsense: true } },
      { text: 'du -sh *', costUsd: 0.01 }
    ])
    const result = await generateCommands('disk usage', config, {
      runner,
      shellPath: '/bin/sh'
    })
    expect(itemAt(result.candidates, 0).command).toBe('du -sh *')
    expect(calls).toHaveLength(2)
  })

  test('count > 1 with a temperature tries temperature first, then retries without', async () => {
    const { runner, calls } = scriptedRunner([
      new Error('temperature not supported'),
      structuredResult([
        candidate,
        {
          command: 'find . -maxdepth 1',
          explanation: 'finds',
          dangerous: false
        }
      ])
    ])
    const result = await generateCommands('list files', config, {
      runner,
      count: 2,
      shellPath: '/bin/sh'
    })
    expect(result.candidates).toHaveLength(2)
    const expectedTemperature = config.interactiveTemperature
    if (expectedTemperature === null) throw new Error('DEFAULT_CONFIG.interactiveTemperature must be set')
    expect(itemAt(calls, 0).opts.temperature).toBe(expectedTemperature)
    expect(itemAt(calls, 1).opts.temperature).toBeUndefined()
  })

  test('no temperature attempt when interactiveTemperature is null', async () => {
    const { runner, calls } = scriptedRunner([structuredResult([candidate])])
    await generateCommands(
      'list files',
      { ...config, interactiveTemperature: null },
      { runner, count: 3, shellPath: '/bin/sh' }
    )
    expect(itemAt(calls, 0).opts.temperature).toBeUndefined()
  })

  test('plain multi-candidate fallback splits on the delimiter', async () => {
    const { runner } = scriptedRunner([
      new Error('no structured'),
      new Error('still no structured'),
      { text: `ls\n${OPTION_DELIMITER}\ndu -sh *`, costUsd: 0 }
    ])
    const result = await generateCommands('list', config, {
      runner,
      count: 2,
      shellPath: '/bin/sh'
    })
    expect(result.candidates.map((c) => c.command)).toEqual(['ls', 'du -sh *'])
  })

  test('dedupes identical commands', async () => {
    const { runner } = scriptedRunner([structuredResult([candidate, { ...candidate, explanation: 'again' }])])
    const result = await generateCommands('list files', config, {
      runner,
      count: 2,
      shellPath: '/bin/sh'
    })
    expect(result.candidates).toHaveLength(1)
  })

  test('sums cost across attempts', async () => {
    const { runner } = scriptedRunner([
      { text: '', costUsd: 0.02, structured: { nope: 1 } },
      { text: 'ls', costUsd: 0.03 }
    ])
    const result = await generateCommands('list', config, {
      runner,
      shellPath: '/bin/sh'
    })
    expect(result.costUsd).toBeCloseTo(0.05)
  })

  test('throws an AicmdError when every attempt fails', async () => {
    const { runner } = scriptedRunner([new AicmdError('model exploded'), new AicmdError('model exploded again')])
    await expect(generateCommands('list', config, { runner, shellPath: '/bin/sh' })).rejects.toThrow(
      'model exploded again'
    )
  })

  test('throws an AicmdError when the model produces nothing usable', async () => {
    const { runner } = scriptedRunner([
      { text: '', costUsd: 0, structured: { commands: [] } },
      { text: '   ', costUsd: 0 }
    ])
    await expect(generateCommands('list', config, { runner, shellPath: '/bin/sh' })).rejects.toThrow(AicmdError)
  })

  test('stops retrying once the run is aborted', async () => {
    const abortController = new AbortController()
    const { runner, calls } = scriptedRunner([new Error('aborted'), structuredResult([candidate])])
    const wrappedRunner: Runner = async (prompt, opts) => {
      abortController.abort()
      return runner(prompt, opts)
    }
    await expect(
      generateCommands('list', config, {
        runner: wrappedRunner,
        abortController,
        shellPath: '/bin/sh'
      })
    ).rejects.toThrow()
    expect(calls).toHaveLength(1)
  })

  test('passes allowApiKey through to the runner', async () => {
    const { runner, calls } = scriptedRunner([structuredResult([candidate])])
    await generateCommands('list', { ...config, allowApiKey: true }, { runner, shellPath: '/bin/sh' })
    expect(itemAt(calls, 0).opts.allowApiKey).toBe(true)
  })
})
