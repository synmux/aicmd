import { describe, expect, test } from 'vitest'
import { AicmdError } from '../src/errors.ts'
import { executeCommand, signalExitCode } from '../src/exec.ts'

describe('executeCommand', () => {
  test("returns the command's exit code", async () => {
    expect(await executeCommand('exit 0', '/bin/sh')).toBe(0)
    expect(await executeCommand('exit 3', '/bin/sh')).toBe(3)
  })

  test('maps a signal death to 128 + signal number', async () => {
    expect(await executeCommand('kill -TERM $$', '/bin/sh')).toBe(143)
  })

  test('a missing shell rejects with an AicmdError', async () => {
    await expect(executeCommand('true', '/definitely/not/a/shell')).rejects.toThrow(AicmdError)
  })

  test('takes over SIGINT while the child runs and restores listeners after', async () => {
    let outerFired = false
    const outer = () => {
      outerFired = true
    }
    process.on('SIGINT', outer)
    try {
      // The child interrupts the whole process group; the parent must survive
      // (its own handlers detached) and still report the child's exit code.
      const code = await executeCommand('kill -INT $PPID; exit 7', '/bin/sh')
      expect(code).toBe(7)
      expect(outerFired).toBe(false)
      expect(process.listeners('SIGINT')).toContain(outer)
    } finally {
      process.off('SIGINT', outer)
    }
  })
})

describe('signalExitCode', () => {
  test('follows the 128 + N convention', () => {
    expect(signalExitCode('SIGTERM')).toBe(143)
    expect(signalExitCode('SIGINT')).toBe(130)
    expect(signalExitCode('SIGKILL')).toBe(137)
  })
})
