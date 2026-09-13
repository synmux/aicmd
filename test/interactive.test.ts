import { describe, expect, test } from 'vitest'
import { type PickerEntry, pickerEntryLabel, pickerHeight } from '../src/ui/interactive.ts'

const entry = (command: string, explanation: string, dangerous = false, reasons: string[] = []): PickerEntry => ({
  candidate: { command, explanation, dangerous, modelAssessed: true },
  danger: { dangerous, reasons, modelSignalAvailable: true }
})

describe('pickerHeight', () => {
  test('sizes to two rows per candidate', () => {
    expect(pickerHeight(1, 40)).toBe(2)
    expect(pickerHeight(3, 40)).toBe(6)
    expect(pickerHeight(5, 40)).toBe(10)
  })

  test('never collapses to zero, even for a zero count', () => {
    expect(pickerHeight(0, 40)).toBe(2)
  })

  test('caps to the terminal (minus chrome) when options overflow, flooring at one item', () => {
    expect(pickerHeight(8, 14)).toBe(10) // wanted 16, capped to 14 - 4
    expect(pickerHeight(8, 10)).toBe(6) // wanted 16, capped to 10 - 4
    expect(pickerHeight(5, 5)).toBe(2) // tiny terminal floors at one item
  })
})

describe('pickerEntryLabel', () => {
  test('prefixes dangerous commands with a warning marker', () => {
    expect(pickerEntryLabel(entry('rm -rf /tmp/x', 'removes', true))).toBe('⚠ rm -rf /tmp/x')
    expect(pickerEntryLabel(entry('ls -la', 'lists'))).toBe('ls -la')
  })
})
