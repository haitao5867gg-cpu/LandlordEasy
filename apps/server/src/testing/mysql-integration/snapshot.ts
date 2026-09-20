/**
 * Deep, stable normalization for persisted-row snapshot comparisons.
 * Prisma `Decimal` and `Date` instances are structurally noisy across
 * separate reads even when the represented value is identical, so both are
 * converted to plain strings before `toEqual`/`toStrictEqual` comparisons.
 *
 * The generic cast on the return value is deliberate: callers keep the
 * ergonomic property access of the original shape (e.g. `snapshot.request`)
 * even though `Decimal`/`Date` leaves are runtime-converted to strings. This
 * is a test-only comparison helper, not a production type boundary.
 */
function normalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === 'object') {
    const maybeDecimal = value as { toFixed?: unknown; constructor?: { name?: string } };
    if (
      typeof maybeDecimal.toFixed === 'function' &&
      maybeDecimal.constructor?.name === 'Decimal'
    ) {
      return (value as { toString(): string }).toString();
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const result: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      result[key] = normalizeValue(entryValue);
    }
    return result;
  }
  return value;
}

export function normalizeForSnapshot<T>(value: T): T {
  return normalizeValue(value) as T;
}
