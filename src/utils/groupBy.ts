/**
 * Polyfill-style groupBy that works on Node 20 (which lacks Object.groupBy).
 * Returns a plain object keyed by the result of the callback.
 */
export function groupBy<T, K extends PropertyKey>(
  items: Iterable<T>,
  keyFn: (item: T) => K,
): Partial<Record<K, T[]>> {
  const result = Object.create(null) as Record<K, T[]>;
  for (const item of items) {
    const key = keyFn(item);
    (result[key] ??= []).push(item);
  }
  return result;
}
