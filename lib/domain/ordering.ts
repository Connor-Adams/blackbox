/** Order timeline items chronologically by start time. Returns a new array
 *  (does not mutate input). Array.prototype.sort is stable, so items with
 *  equal timestamps keep their input order. */
export function orderTimeline<T extends { startedAt: Date }>(events: readonly T[]): T[] {
  return [...events].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
}
