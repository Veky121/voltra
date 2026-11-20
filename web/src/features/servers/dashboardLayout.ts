export type DashboardSection = 'insights' | 'resources' | 'console';
/** Same width as the dashboard's single-column breakpoint in dashboard-ui.css. */
export const NARROW_DASHBOARD_QUERY = '(max-width: 760px)';

/** Section order for the server dashboard. On a phone the console is the main tool, so it comes before the charts. */
export function dashboardSections(narrow: boolean): DashboardSection[] {
  return narrow ? ['console', 'insights', 'resources'] : ['insights', 'resources', 'console'];
}

export function subscribeNarrowDashboard(change: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(NARROW_DASHBOARD_QUERY);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}
export const isNarrowDashboard = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.(NARROW_DASHBOARD_QUERY).matches;
