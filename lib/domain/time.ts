const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Half-open UTC instant range for a calendar date string "YYYY-MM-DD":
 *  [date T00:00:00Z, nextDay T00:00:00Z). v0 treats days as UTC;
 *  timezone-aware ranges are a later refinement. */
export function dayRange(date: string): { start: Date; end: Date } {
  if (!DATE_RE.test(date)) {
    throw new Error(`Invalid date (expected YYYY-MM-DD): ${date}`);
  }
  const start = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid date: ${date}`);
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}
