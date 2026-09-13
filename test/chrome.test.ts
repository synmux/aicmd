import { describe, expect, test } from 'vitest'
import {
  printCancelled,
  printCommandBlock,
  printDangerWarning,
  printMuted,
  printRefusal,
  printRunAnnouncement
} from '../src/ui/chrome.ts'
import { fakeTerminal } from './terminal.ts'

describe('chrome', () => {
  test('printCommandBlock frames the command under a title', () => {
    const terminal = fakeTerminal()
    printCommandBlock("find . -name '*.log' -delete", terminal.output)
    expect(terminal.text()).toContain("find . -name '*.log' -delete")
    expect(terminal.text()).toContain('Command')
  })

  test('printDangerWarning lists every reason', () => {
    const terminal = fakeTerminal()
    printDangerWarning({ reasons: ['matches guard pattern', 'model: deletes files'] }, terminal.output)
    expect(terminal.text()).toContain('potentially destructive')
    expect(terminal.text()).toContain('matches guard pattern')
    expect(terminal.text()).toContain('model: deletes files')
  })

  test('printMuted and printRefusal write their text', () => {
    const terminal = fakeTerminal()
    printMuted('Lists the largest files.', terminal.output)
    printRefusal(['SAFETY: refusing to auto-execute.', 'Re-run with --force.'], terminal.output)
    expect(terminal.text()).toContain('Lists the largest files.')
    expect(terminal.text()).toContain('SAFETY: refusing to auto-execute.')
    expect(terminal.text()).toContain('Re-run with --force.')
  })

  test('printCancelled and printRunAnnouncement close the flow', () => {
    const terminal = fakeTerminal()
    printCancelled('Nothing was executed.', terminal.output)
    printRunAnnouncement('ls -la', terminal.output)
    expect(terminal.text()).toContain('Nothing was executed.')
    expect(terminal.text()).toContain('ls -la')
  })

  test('every helper writes only to the given stream', () => {
    const terminal = fakeTerminal()
    const before = { out: process.stdout.write, err: process.stderr.write }
    let leaked = 0
    process.stdout.write = (() => {
      leaked++
      return true
    }) as typeof process.stdout.write
    process.stderr.write = (() => {
      leaked++
      return true
    }) as typeof process.stderr.write
    try {
      printCommandBlock('ls', terminal.output)
      printDangerWarning({ reasons: ['x'] }, terminal.output)
      printMuted('m', terminal.output)
      printRefusal(['r'], terminal.output)
      printCancelled('c', terminal.output)
      printRunAnnouncement('ls', terminal.output)
    } finally {
      process.stdout.write = before.out
      process.stderr.write = before.err
    }
    expect(leaked).toBe(0)
  })
})
