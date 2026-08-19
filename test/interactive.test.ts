import { describe, expect, test } from 'bun:test'
import * as tui from '@opentui/core'
import { createTestRenderer } from '@opentui/core/testing'
import { buildPickerScene, type PickerEntry, pickerEntryLabel, pickerHeight } from '../src/ui/interactive.ts'

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

describe('buildPickerScene', () => {
  const entries: PickerEntry[] = [
    entry('du -sh * | sort -h', 'sorted sizes of everything here'),
    entry('find . -maxdepth 1 -size +100M', 'finds large files'),
    entry('rm -rf ./cache', 'clears the cache', true, ['matches guard pattern'])
  ]

  async function renderScene(width: number, height: number, list: PickerEntry[]) {
    const { renderer, renderOnce, captureCharFrame } = await createTestRenderer({
      width,
      height
    })
    const scene = buildPickerScene(renderer, tui, list, height)
    renderer.root.add(scene.root)
    await renderOnce()
    const frame = captureCharFrame()
    try {
      renderer.destroy()
    } catch {
      /* headless teardown is best-effort */
    }
    return { scene, frame }
  }

  test('lists every candidate command', async () => {
    const { scene, frame } = await renderScene(120, 40, entries)
    expect(scene.select.height).toBeGreaterThanOrEqual(entries.length * 2)
    for (const item of entries) {
      expect(frame).toContain(item.candidate.command)
    }
  })

  test('marks dangerous candidates in the list', async () => {
    const { frame } = await renderScene(120, 40, entries)
    expect(frame).toContain('⚠')
  })

  test('shows explanations as descriptions', async () => {
    const { frame } = await renderScene(120, 40, entries)
    expect(frame).toContain('sorted sizes of everything here')
  })

  test('keeps the picker visible on a small terminal', async () => {
    const { scene, frame } = await renderScene(80, 12, entries)
    expect(scene.select.height).toBeGreaterThanOrEqual(2)
    const firstEntry = entries.at(0)
    expect(firstEntry).toBeDefined()
    if (firstEntry === undefined) throw new Error('Expected a picker entry')
    expect(frame).toContain(firstEntry.candidate.command)
  })

  test('caps height and scrolls when there are more options than fit', async () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      entry(`echo option number ${index + 1}`, `option ${index + 1}`)
    )
    const { scene } = await renderScene(80, 16, many)
    // 12 options want 24 rows, but a 16-row terminal caps to 16 - 4 = 12.
    expect(scene.select.height).toBe(12)
    expect(scene.select.height).toBeLessThan(many.length * 2)
  })
})
