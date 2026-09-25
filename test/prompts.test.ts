import { describe, expect, test } from 'vitest'
import {
  buildSystem,
  buildUser,
  COMMANDS_SCHEMA,
  cleanCommand,
  extractCandidates,
  normaliseCommand,
  OPTION_DELIMITER,
  plainToCandidates
} from '../src/prompts.ts'
import { itemAt } from './helpers.ts'

const baseSystemOpts = {
  shellPath: '/bin/zsh',
  contextBlock: 'Platform: macOS.' as string | null,
  customPrompt: null as string | null,
  count: 1,
  structured: true
}

describe('buildSystem', () => {
  test('demands exactly one single-line command and no task execution', () => {
    const system = buildSystem(baseSystemOpts)
    expect(system).toMatch(/single/i)
    expect(system).toMatch(/one line|single line|single-line/i)
    expect(system).toMatch(/do not (perform|execute|carry out)/i)
  })

  test('includes the context block when provided', () => {
    expect(buildSystem(baseSystemOpts)).toContain('Platform: macOS.')
    expect(buildSystem({ ...baseSystemOpts, contextBlock: null })).not.toContain('Platform: macOS.')
  })

  test('asks for the danger assessment', () => {
    const system = buildSystem(baseSystemOpts)
    expect(system).toMatch(/danger/i)
  })

  test('appends the custom prompt', () => {
    const system = buildSystem({
      ...baseSystemOpts,
      customPrompt: 'Prefer eza over ls.'
    })
    expect(system).toContain('Prefer eza over ls.')
  })

  test('plain mode forbids markdown; structured mode scopes rules to fields', () => {
    const plain = buildSystem({ ...baseSystemOpts, structured: false })
    expect(plain).toMatch(/no (markdown|code fences|explanation)/i)
  })

  test('still names the target shell when context is disabled', () => {
    const system = buildSystem({ ...baseSystemOpts, contextBlock: null })
    expect(system).toContain('zsh')
  })
})

describe('buildUser', () => {
  test('single candidate asks for one command', () => {
    const user = buildUser('list the five largest files', 1, true)
    expect(user).toContain('list the five largest files')
  })

  test('multiple candidates ask for distinct options', () => {
    const user = buildUser('compress this directory', 3, true)
    expect(user).toContain('3')
    expect(user).toMatch(/distinct|different/i)
  })

  test('plain multi-candidate mode names the delimiter', () => {
    const user = buildUser('compress this directory', 3, false)
    expect(user).toContain(OPTION_DELIMITER)
  })
})

describe('COMMANDS_SCHEMA and extractCandidates', () => {
  test('schema requires command, explanation and dangerous', () => {
    const properties = COMMANDS_SCHEMA.properties as Record<string, Record<string, unknown>>
    const items = properties.commands?.items as Record<string, unknown> | undefined
    expect(items?.required).toEqual(['command', 'explanation', 'dangerous'])
  })

  test('extracts well-formed candidates', () => {
    const out = extractCandidates({
      commands: [
        {
          command: 'ls -la',
          explanation: 'lists files',
          dangerous: false
        },
        {
          command: 'rm -rf /tmp/x',
          explanation: 'removes it',
          dangerous: true,
          dangerReason: 'deletes files'
        }
      ]
    })
    expect(out).toHaveLength(2)
    expect(itemAt(out, 0).command).toBe('ls -la')
    expect(itemAt(out, 1).dangerous).toBe(true)
    expect(itemAt(out, 1).dangerReason).toBe('deletes files')
  })

  test('rejects malformed shapes', () => {
    expect(extractCandidates(null)).toBeNull()
    expect(extractCandidates({})).toBeNull()
    expect(extractCandidates({ commands: [] })).toBeNull()
    expect(extractCandidates({ commands: ['ls'] })).toBeNull()
    expect(extractCandidates({ commands: [{ explanation: 'x', dangerous: false }] })).toBeNull()
  })

  test('tolerates a missing dangerous flag by treating it as false', () => {
    const out = extractCandidates({
      commands: [{ command: 'ls', explanation: 'lists' }]
    })
    expect(out).toHaveLength(1)
    expect(itemAt(out, 0).dangerous).toBe(false)
  })

  test('trims command whitespace and drops empty commands', () => {
    const out = extractCandidates({
      commands: [
        { command: '  ls -la\n', explanation: 'x', dangerous: false },
        { command: '   ', explanation: 'y', dangerous: false }
      ]
    })
    expect(out).toHaveLength(1)
    expect(itemAt(out, 0).command).toBe('ls -la')
  })

  test('marks structured candidates as model-assessed', () => {
    const out = extractCandidates({
      commands: [{ command: 'ls', explanation: 'lists', dangerous: false }]
    })
    expect(itemAt(out, 0).modelAssessed).toBe(true)
  })

  test('rejects commands smuggling control characters', () => {
    // A carriage return lets the rendered confirmation differ from what
    // executes (the terminal overwrites the line), so such candidates are
    // dropped rather than displayed.
    expect(
      extractCandidates({
        commands: [
          {
            command: 'find ~ -type f -delete\recho hello              ',
            explanation: 'x',
            dangerous: false
          }
        ]
      })
    ).toBeNull()
    expect(
      extractCandidates({
        commands: [{ command: 'ls [8mhidden[0m', explanation: 'x', dangerous: false }]
      })
    ).toBeNull()
  })

  test('rejects multi-line structured commands instead of truncating them', () => {
    expect(
      extractCandidates({
        commands: [{ command: 'mkdir foo\ncd foo', explanation: 'x', dangerous: false }]
      })
    ).toBeNull()
  })
})

describe('normaliseCommand', () => {
  test('passes ordinary commands through trimmed', () => {
    expect(normaliseCommand('  ls -la  ')).toBe('ls -la')
  })

  test('rejects control characters and multi-line text', () => {
    expect(normaliseCommand('ls\recho hi')).toBeNull()
    expect(normaliseCommand('ls [2K')).toBeNull()
    expect(normaliseCommand('ls\tdir')).toBeNull()
    expect(normaliseCommand('a\nb')).toBeNull()
    expect(normaliseCommand('')).toBeNull()
  })
})

describe('cleanCommand', () => {
  test('strips a wrapping code fence', () => {
    expect(cleanCommand('```sh\nls -la\n```')).toBe('ls -la')
    expect(cleanCommand('```\nls -la\n```')).toBe('ls -la')
  })

  test('extracts a fenced block even when prose surrounds it', () => {
    expect(cleanCommand("Here's the command:\n```sh\nls -la\n```")).toBe('ls -la')
    expect(cleanCommand('Use this:\n\n```\ndu -sh *\n```\n\nThat should work.')).toBe('du -sh *')
  })

  test('takes the first non-empty line of a multi-line response', () => {
    expect(cleanCommand('\n\nls -la\necho done')).toBe('ls -la')
  })

  test('strips a leading shell prompt marker', () => {
    expect(cleanCommand('$ ls -la')).toBe('ls -la')
  })

  test('strips matching wrapping quotes and backticks', () => {
    expect(cleanCommand('"ls -la"')).toBe('ls -la')
    expect(cleanCommand('`ls -la`')).toBe('ls -la')
    expect(cleanCommand("'ls -la'")).toBe('ls -la')
  })

  test('keeps interior quotes intact', () => {
    expect(cleanCommand("grep 'foo bar' file.txt")).toBe("grep 'foo bar' file.txt")
  })

  test('empty input stays empty', () => {
    expect(cleanCommand('')).toBe('')
    expect(cleanCommand('```\n```')).toBe('')
  })
})

describe('plainToCandidates', () => {
  test('a single plain response becomes one candidate with unknown danger', () => {
    const out = plainToCandidates('ls -la', 1)
    expect(out).toHaveLength(1)
    expect(itemAt(out, 0).command).toBe('ls -la')
    expect(itemAt(out, 0).dangerous).toBe(false)
    expect(itemAt(out, 0).explanation).toBe('')
    expect(itemAt(out, 0).modelAssessed).toBe(false)
  })

  test('drops candidates that keep control characters after cleanup', () => {
    expect(plainToCandidates('ls\r-la', 1)).toHaveLength(0)
  })

  test('splits multi-candidate responses on the delimiter', () => {
    const text = `ls -la\n${OPTION_DELIMITER}\nfind . -type f\n${OPTION_DELIMITER}\ndu -sh *`
    const out = plainToCandidates(text, 3)
    expect(out.map((c) => c.command)).toEqual(['ls -la', 'find . -type f', 'du -sh *'])
  })

  test('drops empty segments', () => {
    const out = plainToCandidates(`ls\n${OPTION_DELIMITER}\n\n${OPTION_DELIMITER}\npwd`, 3)
    expect(out.map((c) => c.command)).toEqual(['ls', 'pwd'])
  })
})
