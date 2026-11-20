/**
 * Applies newer values from the panel to a form the user is editing: every
 * field still equal to what the form started from takes the newer value, and
 * every field the user changed keeps the change.
 */
export function mergeFreshValues<T extends Record<string, unknown>>(current: T, baseline: T, next: T): T {
  const merged: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(current), ...Object.keys(next)]))
    merged[key] = JSON.stringify(current[key]) === JSON.stringify(baseline[key]) ? next[key] : current[key];
  return merged as T;
}
