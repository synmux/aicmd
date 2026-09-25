/**
 * Shared assertion helpers for the test suites.
 *
 * With `noUncheckedIndexedAccess`, indexing an array yields `T | undefined`
 * even right after an `expect(...).toHaveLength(n)` — TypeScript cannot see
 * through the matcher. Rather than sprinkling non-null assertions (banned by
 * Biome's `noNonNullAssertion`), tests fetch elements through {@link itemAt},
 * which fails the test loudly when the element is missing.
 */

/**
 * The element at `index`, or a thrown error (failing the surrounding test)
 * when the array is nullish or too short.
 */
export function itemAt<Item>(items: readonly Item[] | null | undefined, index: number): Item {
  const item = items?.[index];
  if (item === undefined) {
    throw new Error(`Expected an item at index ${index}, but the array has ${items?.length ?? "no"} item(s)`);
  }
  return item;
}
