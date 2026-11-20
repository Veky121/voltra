import {connectionAddress} from './connectionAddress.ts';
import type {ProxyRoute, ServerAllocation, ServerSubdomain} from '../../types/api';

type Row = Record<string, any>;
export function portConnectionActions(
  port: Row,
  setup: Row | undefined,
  domain: Row | undefined,
  admin: boolean,
  writable: boolean
) {
  const ids = new Set(
    (setup?.allocations || []).find((p: Row) => String(p.id) === String(port.id))?.forward_client_ids || []
  );
  const clients = admin ? (setup?.clients || []).filter((c: Row) => ids.has(c.id)) : [];
  const domainChoices = port.is_default ? domain?.choices || [] : [];
  return {clients, domainChoices, forward: clients.length > 0, subdomain: writable && domainChoices.length > 0};
}

export function groupPortRoutes(routes: Row[]): (Row & {members: Row[]})[] {
  const groups = new Map<string, Row[]>();
  for (const route of routes) {
    const key = JSON.stringify([
      route.public_host,
      route.public_port,
      route.local_ip,
      route.local_port,
      route.gateway_id,
      route.client_id,
    ]);
    const members = groups.get(key) || [];
    members.push(route);
    groups.set(key, members);
  }
  return [...groups.values()].map(members => {
    const protocols = [...new Set(members.map(r => String(r.protocol).toUpperCase()))].sort((a, b) => {
      const order = ['TCP', 'UDP', 'HTTP', 'HTTPS'];
      return (
        (order.indexOf(a) < 0 ? 99 : order.indexOf(a)) - (order.indexOf(b) < 0 ? 99 : order.indexOf(b)) ||
        a.localeCompare(b)
      );
    });
    const status = members.every(r => r.status === members[0].status)
      ? members[0].status
      : members.some(r => r.status === 'error')
        ? 'error'
        : 'pending';
    return {
      ...members[0],
      members,
      protocol: protocols.join(' & '),
      status,
      desired_present: members.some(r => r.desired_present !== false),
      last_error: [...new Set(members.map(r => r.last_error).filter(Boolean))].join(' '),
    };
  });
}

export type PlayerAddress = {
  label: string;
  value: string;
  /** Where the address comes from, most shareable first. */
  source: 'subdomain' | 'public' | 'local';
  /** A local test address that was never published. */
  simulated: boolean;
};

export function playerAddress(
  port: Pick<ServerAllocation, 'ip' | 'port' | 'protocols' | 'protocol_source'>,
  routes: ProxyRoute[],
  domain: Partial<Pick<ServerSubdomain, 'hostname' | 'dns_matches' | 'dns_status' | 'cleanup_pending'>> & {
    route?: {public_port: number};
  },
  preferredProtocol?: string
): PlayerAddress {
  if (domain.hostname && domain.route && domain.dns_status !== 'error' && !domain.cleanup_pending) {
    const simulated = domain.dns_status === 'simulated';
    if (domain.dns_matches || simulated)
      return {
        label: simulated ? 'Test address' : 'Player address',
        value: connectionAddress(domain.hostname, domain.route.public_port),
        source: 'subdomain',
        simulated,
      };
  }
  const configured = routes.filter(
    route => route.desired_present !== false && ['applied', 'simulated'].includes(route.status)
  );
  const protocol = preferredProtocol || (port.protocol_source === 'game' ? port.protocols?.[0] : undefined);
  const route = configured.find(route => route.protocol === protocol) ?? configured[0];
  if (route)
    return {
      label: route.status === 'simulated' ? 'Test address' : 'Player address',
      value: connectionAddress(route.public_host, route.public_port),
      source: 'public',
      simulated: route.status === 'simulated',
    };
  return {label: 'Local address', value: connectionAddress(port.ip, port.port), source: 'local', simulated: false};
}
