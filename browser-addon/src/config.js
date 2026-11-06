export function panelURL(input) {
  let value = String(input || '').trim();
  if (value.startsWith('//')) value = 'https:' + value;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = 'https://' + value;
  let url;
  try { url = new URL(value); } catch { throw new Error('invalid-panel'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !(url.protocol === 'https:' || url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
    throw new Error('invalid-panel');
  }
  return url.origin;
}

// Browser host permissions cover all ports on a host; match patterns omit ports.
export function panelPermission(panel) {
  const url = new URL(panelURL(panel));
  return `${url.protocol}//${url.hostname}/*`;
}

export function transferProgress(entry) {
  if (entry.size_known !== true || !(entry.total_bytes > 0) || !Number.isFinite(entry.received_bytes)) return null;
  return Math.max(0, Math.min(100, Math.floor(entry.received_bytes / entry.total_bytes * 100)));
}
