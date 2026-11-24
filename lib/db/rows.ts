/**
 * `db.execute()` returns an array on the postgres.js driver and `{ rows }` on
 * some others. Normalise once instead of casting at every call site.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const maybe = result as { rows?: unknown[] } | null;
  if (maybe && Array.isArray(maybe.rows)) return maybe.rows as T[];
  return [];
}

export function firstRow<T>(result: unknown): T | null {
  return rowsOf<T>(result)[0] ?? null;
}
