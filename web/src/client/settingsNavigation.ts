export function settingsTab(search: URLSearchParams, allowed: readonly string[], fallback = 'general') {
  const tab = search.get('tab');
  return tab && allowed.includes(tab) ? tab : fallback;
}

export function settingsTabSearch(search: URLSearchParams, tab: string) {
  const next = new URLSearchParams(search);
  next.set('tab', tab);
  return next;
}
