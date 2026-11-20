/** Folders with more rows than this render only the rows near the viewport. */
export const ROW_WINDOW_THRESHOLD = 200;
/** Rows kept above and below the viewport, so Tab and short scrolls land on rendered rows. */
export const ROW_WINDOW_OVERSCAN = 20;

/** One rendered row and the empty space to leave before it for skipped rows. */
export type RowSlice = {index: number; gap: number};
export type RowWindow = {rows: RowSlice[]; tail: number};

/**
 * Pick the rows to render for a long list. `viewTop` and `viewBottom` are the
 * visible part of the scroll container, measured from the top of the list.
 * Rows can differ in height (an expanded folder holds its children), so
 * `heightOf` gives each row's last measured height. Pinned rows (expanded
 * folders, the focused row, the open file) always render, so their state and
 * focus survive scrolling.
 */
export function rowWindow({
  count,
  heightOf,
  viewTop,
  viewBottom,
  overscan = ROW_WINDOW_OVERSCAN,
  pinned = [],
}: {
  count: number;
  heightOf: (index: number) => number;
  viewTop: number;
  viewBottom: number;
  overscan?: number;
  pinned?: Iterable<number>;
}): RowWindow {
  const offsets = new Array<number>(count + 1);
  offsets[0] = 0;
  for (let i = 0; i < count; i++) offsets[i + 1] = offsets[i] + Math.max(0, heightOf(i));
  // First row whose bottom is below the top of the view, and first row whose top is at or below its bottom.
  let first = 0;
  while (first < count && offsets[first + 1] <= viewTop) first++;
  let last = first;
  while (last < count && offsets[last] < viewBottom) last++;
  const start = Math.max(0, first - overscan),
    end = Math.min(count, last + overscan);
  const indices = new Set<number>();
  for (let i = start; i < end; i++) indices.add(i);
  for (const index of pinned) if (Number.isInteger(index) && index >= 0 && index < count) indices.add(index);
  const sorted = [...indices].sort((a, b) => a - b);
  const rows: RowSlice[] = [];
  let next = 0;
  for (const index of sorted) {
    rows.push({index, gap: offsets[index] - offsets[next]});
    next = index + 1;
  }
  return {rows, tail: offsets[count] - offsets[next]};
}

/** Every row, no spacers. Used below the threshold. */
export function fullWindow(count: number): RowWindow {
  return {rows: Array.from({length: count}, (_, index) => ({index, gap: 0})), tail: 0};
}

export function sameWindow(a: RowWindow, b: RowWindow): boolean {
  if (a.tail !== b.tail || a.rows.length !== b.rows.length) return false;
  for (let i = 0; i < a.rows.length; i++)
    if (a.rows[i].index !== b.rows[i].index || a.rows[i].gap !== b.rows[i].gap) return false;
  return true;
}
