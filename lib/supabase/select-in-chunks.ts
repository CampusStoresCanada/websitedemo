/**
 * Read rows for a long list of ids, a chunk at a time.
 *
 * `.in("id", ids)` puts every id in the request address. Past a few hundred the
 * address is too long and the API answers "Bad Request" (measured 2026-10-05:
 * 200 fine, 792 refused; the exact point depends on the rest of the query). A
 * conference-wide list of people or contacts crosses that line as the event
 * fills, so those reads go through here.
 *
 * Returns the same `{ data, error }` shape as a single read, so a call site
 * changes by one line. Stops at the first failed chunk and reports it: a short
 * list must never pass for a complete one.
 */
export const IN_CHUNK = 150;

export async function selectInChunks<Row>(
  ids: string[],
  fetchChunk: (chunk: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }>
): Promise<{ data: Row[]; error: { message: string } | null }> {
  const unique = [...new Set(ids.filter(Boolean))];
  const data: Row[] = [];
  for (let i = 0; i < unique.length; i += IN_CHUNK) {
    const res = await fetchChunk(unique.slice(i, i + IN_CHUNK));
    if (res.error) return { data, error: res.error };
    data.push(...(((res.data as Row[] | null) ?? [])));
  }
  return { data, error: null };
}
