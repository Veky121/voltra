export function connectionAddress(host: string, port: unknown) {
  return `${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}`;
}

// Allocation aliases may be display labels, not DNS names.
function dnsHostname(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const host = value.trim().replace(/\.$/, '');
  if (host.length > 253 || !host.includes('.') || /^[\d.]+$/.test(host)) return null;
  return host.split('.').every(label => /^[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?$/i.test(label)) ? host : null;
}

export function connectionDNS(
  primary: {port: unknown; ip_alias?: unknown; alias?: unknown} | undefined,
  routes: Array<{public_host: string; public_port: unknown}>,
  joinDomain?: {hostname?: unknown; route?: {public_port: unknown}} | null,
) {
  const joinHost = dnsHostname(joinDomain?.hostname);
  if (joinHost && joinDomain?.route) return connectionAddress(joinHost, joinDomain.route.public_port);
  const gateway = routes.find(route => dnsHostname(route.public_host));
  if (gateway) return connectionAddress(dnsHostname(gateway.public_host)!, gateway.public_port);
  // A node alias does not establish a DNS alias for a different proxy target.
  if (routes.length) return null;
  const alias = dnsHostname(primary?.ip_alias) || dnsHostname(primary?.alias);
  return alias && primary ? connectionAddress(alias, primary.port) : null;
}
