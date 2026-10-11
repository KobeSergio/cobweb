/**
 * Runs `work` over `items` with at most `limit` in flight and returns the results in input order.
 * After the first failure no new item starts; the call waits for the ones in flight, then rejects
 * with that first failure, so nothing keeps running once it has settled.
 */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  const failures: unknown[] = []
  let next = 0
  const worker = async () => {
    while (failures.length === 0 && next < items.length) {
      const index = next++
      try {
        results[index] = await work(items[index]!)
      } catch (error) {
        failures.push(error)
      }
    }
  }
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  await Promise.all(Array.from({ length: width }, () => worker()))
  if (failures.length > 0) throw failures[0]
  return results
}
