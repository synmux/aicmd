import { describe, expect, test } from 'bun:test'
import { itemAt } from './helpers.ts'

describe('itemAt', () => {
  test('returns the element at the index', () => {
    expect(itemAt(['a', 'b'], 1)).toBe('b')
  })

  test('throws on an out-of-range index', () => {
    expect(() => itemAt(['a'], 3)).toThrow('Expected an item at index 3')
  })

  test('throws on null and undefined arrays', () => {
    expect(() => itemAt(null, 0)).toThrow('no item(s)')
    expect(() => itemAt(undefined, 0)).toThrow('no item(s)')
  })
})
