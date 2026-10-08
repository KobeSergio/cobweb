/** The most rows PostgREST returns for one request (`max_rows` in supabase/config.toml). */
export const PAGE_SIZE = 1000

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/**
 * Reads every row of a query a page at a time, so a project with more than 1,000 traits or tokens
 * loads whole. A truncated read would be worse than an error: the next save would write it back.
 */
export async function readAll<T>(
  page: (from: number, to: number) => Page<T>,
  size = PAGE_SIZE,
): Promise<T[]> {
  const rows: T[] = []
  // A short page is not the last one: the server may cap a page below `size`. Only an empty page ends it.
  for (let from = 0; ;) {
    const { data, error } = await page(from, from + size - 1)
    if (error) throw new Error(`The art could not be loaded: ${error.message}`)
    if (!data || data.length === 0) return rows
    rows.push(...data)
    from += data.length
  }
}
